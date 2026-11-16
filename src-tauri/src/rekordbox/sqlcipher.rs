//! Pure-Rust, read-only decryption of rekordbox's SQLCipher 4 `master.db`.
//!
//! We never open rekordbox's files with SQLite. Instead the encrypted bytes of
//! `master.db` (and committed frames of `master.db-wal`, if rekordbox is running)
//! are read, decrypted in memory and handed back as a plain SQLite image. This makes
//! writing to rekordbox data impossible by construction and avoids an OpenSSL build.
//!
//! SQLCipher 4 defaults: 4096-byte pages, 80 reserved bytes per page (16 IV + 64 HMAC),
//! PBKDF2-HMAC-SHA512 with 256000 rounds, AES-256-CBC, HMAC-SHA512 over
//! `ciphertext || iv || page_number_le`.

use std::path::Path;
use std::sync::Mutex;

use aes::cipher::{BlockModeDecrypt, KeyIvInit, block_padding::NoPadding};
use hmac::{Hmac, KeyInit, Mac};
use sha2::Sha512;

use crate::Error;

/// Publicly known passphrase of rekordbox 6/7 `master.db` (same as pyrekordbox uses).
const PASSPHRASE: &[u8] = b"402fd482c38817c35ffa8ffb8c7d93143b749e7d315df7a81732a1ff43608497";
const PAGE_SIZE: usize = 4096;
const RESERVE: usize = 80;
const SALT_LEN: usize = 16;
const KDF_ROUNDS: u32 = 256_000;
const WAL_HEADER: usize = 32;
const FRAME_HEADER: usize = 24;

type Aes256CbcDec = cbc::Decryptor<aes::Aes256>;

struct Keys {
    enc: [u8; 32],
    mac: [u8; 32],
    salt: [u8; SALT_LEN],
}

/// The KDF is slow (~0.1 s optimized), and the salt never changes for a database.
static KEY_CACHE: Mutex<Option<Keys>> = Mutex::new(None);

fn with_keys<T>(salt: &[u8], f: impl FnOnce(&Keys) -> T) -> T {
    let mut cache = KEY_CACHE.lock().unwrap_or_else(|e| e.into_inner());
    if cache.as_ref().is_none_or(|k| k.salt != salt) {
        let mut enc = [0u8; 32];
        pbkdf2::pbkdf2_hmac::<Sha512>(PASSPHRASE, salt, KDF_ROUNDS, &mut enc);
        let mac_salt: Vec<u8> = salt.iter().map(|b| b ^ 0x3a).collect();
        let mut mac = [0u8; 32];
        pbkdf2::pbkdf2_hmac::<Sha512>(&enc, &mac_salt, 2, &mut mac);
        *cache = Some(Keys {
            enc,
            mac,
            salt: salt.try_into().expect("salt length"),
        });
    }
    f(cache.as_ref().expect("keys just set"))
}

/// Decrypt one page (`page_no` is 1-based). Returns `None` if the HMAC does not verify.
fn decrypt_page(keys: &Keys, page: &[u8], page_no: u32) -> Option<Vec<u8>> {
    let start = if page_no == 1 { SALT_LEN } else { 0 };
    let ct = &page[start..PAGE_SIZE - RESERVE];
    let iv = &page[PAGE_SIZE - RESERVE..PAGE_SIZE - RESERVE + 16];
    let tag = &page[PAGE_SIZE - 64..PAGE_SIZE];
    let mut mac = <Hmac<Sha512> as KeyInit>::new_from_slice(&keys.mac).ok()?;
    mac.update(ct);
    mac.update(iv);
    mac.update(&page_no.to_le_bytes());
    mac.verify_slice(tag).ok()?;

    let mut buf = ct.to_vec();
    Aes256CbcDec::new_from_slices(&keys.enc, iv)
        .ok()?
        .decrypt_padded::<NoPadding>(&mut buf)
        .ok()?;
    let mut out = Vec::with_capacity(PAGE_SIZE);
    if page_no == 1 {
        out.extend_from_slice(b"SQLite format 3\0");
    }
    out.extend_from_slice(&buf);
    out.resize(PAGE_SIZE, 0); // reserved bytes; SQLite ignores them
    Some(out)
}

/// Decrypt `master.db` plus committed frames of `master.db-wal` into a plain SQLite
/// image. The returned image is in rollback-journal mode so it opens without a WAL.
pub fn decrypt_file(db_path: &Path) -> Result<Vec<u8>, Error> {
    let wal_path = wal_path(db_path);
    let read_wal = || std::fs::read(&wal_path).ok().filter(|w| !w.is_empty());
    let mut last_err = None;
    for attempt in 0..5 {
        if attempt > 0 {
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
        // rekordbox may write or checkpoint while we read. Reading the WAL before and
        // after the db gives a consistent snapshot when both WAL reads are identical:
        // pages a checkpoint copies into the db meanwhile are overwritten by the same
        // WAL frames again.
        let wal = read_wal();
        let db = std::fs::read(db_path)
            .map_err(|e| Error::NotFound(format!("cannot read {}: {e}", db_path.display())))?;
        if read_wal() != wal {
            last_err = Some(Error::Invalid(
                "master.db kept changing while reading".into(),
            ));
            continue;
        }
        match decrypt(&db, wal.as_deref()) {
            Ok(img) => return Ok(img),
            Err(Torn(e)) => last_err = Some(e),
            Err(Fatal(e)) => return Err(e),
        }
    }
    Err(last_err.expect("at least one attempt"))
}

fn wal_path(db_path: &Path) -> std::path::PathBuf {
    let mut s = db_path.as_os_str().to_owned();
    s.push("-wal");
    s.into()
}

/// Why decryption failed: `Torn` may succeed on a re-read, `Fatal` will not.
enum Failure {
    Fatal(Error),
    Torn(Error),
}
use Failure::{Fatal, Torn};

fn decrypt(db: &[u8], wal: Option<&[u8]>) -> Result<Vec<u8>, Failure> {
    if db.len() < PAGE_SIZE || !db.len().is_multiple_of(PAGE_SIZE) {
        return Err(Torn(Error::Invalid(
            "master.db has an unexpected size".into(),
        )));
    }
    with_keys(&db[..SALT_LEN], |keys| {
        let mut pages = Vec::with_capacity(db.len() / PAGE_SIZE);
        for (i, page) in db.as_chunks::<PAGE_SIZE>().0.iter().enumerate() {
            let page_no = u32::try_from(i + 1).expect("page count fits u32");
            let Some(plain) = decrypt_page(keys, page, page_no) else {
                return Err(if page_no == 1 {
                    // Page 1 is never torn in practice: wrong key or not a rekordbox db.
                    Fatal(Error::Invalid(
                        "cannot decrypt master.db (unsupported rekordbox version or not a rekordbox database)".into(),
                    ))
                } else {
                    Torn(Error::Invalid(format!(
                        "cannot decrypt master.db page {page_no} (file changed while reading?)"
                    )))
                });
            };
            pages.push(plain);
        }
        if let Some(wal) = wal {
            apply_wal(keys, wal, &mut pages).map_err(Fatal)?;
        }
        let mut img = pages.concat();
        // Header bytes 18/19: file format write/read version. 1 = rollback journal.
        img[18] = 1;
        img[19] = 1;
        // Header bytes 28..32: database size in pages.
        let n = u32::try_from(pages.len()).expect("page count fits u32");
        img[28..32].copy_from_slice(&n.to_be_bytes());
        Ok(img)
    })
}

/// Apply all fully committed transactions of a WAL to `pages`. Stops at the first
/// frame from another WAL generation (salt mismatch), with an invalid header, or that
/// fails its HMAC (an incomplete write); the rest of the WAL is not committed yet.
fn apply_wal(keys: &Keys, wal: &[u8], pages: &mut Vec<Vec<u8>>) -> Result<(), Error> {
    let be = |b: &[u8]| u32::from_be_bytes(b.try_into().expect("4 bytes"));
    if wal.len() < WAL_HEADER || !matches!(be(&wal[0..4]), 0x377f_0682 | 0x377f_0683) {
        return Err(Error::Invalid("master.db-wal has an unknown format".into()));
    }
    if be(&wal[8..12]) as usize != PAGE_SIZE {
        return Err(Error::Invalid(
            "master.db-wal has an unexpected page size".into(),
        ));
    }
    // Generous bound so a corrupt header cannot make us allocate gigabytes.
    let max_pages = pages.len() * 4 + 1024;
    let salts = &wal[16..24];
    let mut pending: Vec<(usize, Vec<u8>)> = Vec::new();
    let mut off = WAL_HEADER;
    while off + FRAME_HEADER + PAGE_SIZE <= wal.len() {
        let hdr = &wal[off..off + FRAME_HEADER];
        let page = &wal[off + FRAME_HEADER..off + FRAME_HEADER + PAGE_SIZE];
        off += FRAME_HEADER + PAGE_SIZE;
        let page_no = be(&hdr[0..4]);
        if &hdr[8..16] != salts || page_no == 0 || page_no as usize > max_pages {
            break;
        }
        let Some(plain) = decrypt_page(keys, page, page_no) else {
            break;
        };
        pending.push((page_no as usize, plain));
        let db_size = be(&hdr[4..8]) as usize;
        if db_size > 0 {
            // Commit frame: apply the whole transaction, if it is consistent.
            if db_size > max_pages || pending.iter().any(|(no, _)| *no > db_size) {
                break;
            }
            pages.resize(db_size, vec![0; PAGE_SIZE]);
            for (no, p) in pending.drain(..) {
                pages[no - 1] = p;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use aes::cipher::BlockModeEncrypt;

    type Aes256CbcEnc = cbc::Encryptor<aes::Aes256>;

    fn ok(r: Result<Vec<u8>, Failure>) -> Vec<u8> {
        match r {
            Ok(v) => v,
            Err(Fatal(e) | Torn(e)) => panic!("{e}"),
        }
    }

    fn encrypt_page(keys: &Keys, plain: &[u8], page_no: u32, salt: &[u8]) -> Vec<u8> {
        let start = if page_no == 1 { SALT_LEN } else { 0 };
        let iv = [page_no as u8; 16];
        let mut ct = plain[start..PAGE_SIZE - RESERVE].to_vec();
        let len = ct.len();
        Aes256CbcEnc::new_from_slices(&keys.enc, &iv)
            .unwrap()
            .encrypt_padded::<NoPadding>(&mut ct, len)
            .unwrap();
        let mut mac = <Hmac<Sha512> as KeyInit>::new_from_slice(&keys.mac).unwrap();
        mac.update(&ct);
        mac.update(&iv);
        mac.update(&page_no.to_le_bytes());
        let mut out = if page_no == 1 {
            salt.to_vec()
        } else {
            Vec::new()
        };
        out.extend_from_slice(&ct);
        out.extend_from_slice(&iv);
        out.extend_from_slice(&mac.finalize().into_bytes());
        out
    }

    fn frame(hdr_salts: &[u8], page_no: u32, commit_size: u32, page: &[u8]) -> Vec<u8> {
        let mut f = Vec::new();
        f.extend_from_slice(&page_no.to_be_bytes());
        f.extend_from_slice(&commit_size.to_be_bytes());
        f.extend_from_slice(hdr_salts);
        f.extend_from_slice(&[0; 8]); // checksums are not used
        f.extend_from_slice(page);
        f
    }

    const SALTS: [u8; 8] = [1, 2, 3, 4, 5, 6, 7, 8];

    fn wal_header() -> Vec<u8> {
        let mut w = vec![0u8; WAL_HEADER];
        w[0..4].copy_from_slice(&0x377f_0682u32.to_be_bytes());
        w[8..12].copy_from_slice(&(PAGE_SIZE as u32).to_be_bytes());
        w[16..24].copy_from_slice(&SALTS);
        w
    }

    /// Fixture bytes and its decrypted base image.
    fn setup() -> Option<(Vec<u8>, Vec<u8>)> {
        let db = std::fs::read(crate::rekordbox::library::tests::fixture()?).unwrap();
        let base = ok(decrypt(&db, None));
        Some((db, base))
    }

    fn enc(db: &[u8], plain: &[u8], no: u32) -> Vec<u8> {
        let salt = &db[..SALT_LEN];
        with_keys(salt, |k| encrypt_page(k, plain, no, salt))
    }

    fn page(img: &[u8], no: usize) -> &[u8] {
        &img[(no - 1) * PAGE_SIZE..no * PAGE_SIZE]
    }

    #[test]
    fn applies_committed_wal_frames_only() {
        let Some((db, base)) = setup() else {
            return;
        };
        let n_pages = (db.len() / PAGE_SIZE) as u32;
        let mut changed = page(&base, 2).to_vec();
        changed[100] ^= 0xff;
        let mut uncommitted = page(&base, 3).to_vec();
        uncommitted[200] ^= 0xff;

        let mut wal = wal_header();
        wal.extend(frame(&SALTS, 2, n_pages, &enc(&db, &changed, 2))); // committed
        wal.extend(frame(&SALTS, 3, 0, &enc(&db, &uncommitted, 3))); // never committed
        wal.extend(frame(&[9; 8], 2, n_pages, &enc(&db, &changed, 2))); // old generation

        let img = ok(decrypt(&db, Some(&wal)));
        assert_eq!(page(&img, 2), &changed[..]);
        assert_eq!(page(&img, 3), page(&base, 3));
        assert_eq!(img.len(), base.len());
    }

    #[test]
    fn wal_page_one_and_truncation() {
        let Some((db, base)) = setup() else {
            return;
        };
        let mut p1 = page(&base, 1).to_vec();
        p1[60] ^= 0x01; // some header byte outside what decrypt rewrites
        let mut wal = wal_header();
        wal.extend(frame(&SALTS, 1, 3, &enc(&db, &p1, 1))); // commit, shrink to 3 pages
        let img = ok(decrypt(&db, Some(&wal)));
        assert_eq!(img.len(), 3 * PAGE_SIZE);
        assert_eq!(img[60], p1[60]);
        assert_eq!(u32::from_be_bytes(img[28..32].try_into().unwrap()), 3);
    }

    #[test]
    fn rejects_bad_wal_frames_and_headers() {
        let Some((db, base)) = setup() else {
            return;
        };
        // A commit claiming fewer pages than it writes is ignored.
        let mut wal = wal_header();
        wal.extend(frame(&SALTS, 5, 2, &enc(&db, page(&base, 5), 5)));
        assert_eq!(ok(decrypt(&db, Some(&wal))), base);
        // An absurd size is ignored instead of allocating.
        let mut wal = wal_header();
        wal.extend(frame(&SALTS, 2, u32::MAX, &enc(&db, page(&base, 2), 2)));
        assert_eq!(ok(decrypt(&db, Some(&wal))), base);
        // Unknown WAL format is an error, not silently stale data.
        assert!(matches!(decrypt(&db, Some(&[0u8; 64])), Err(Fatal(_))));
    }

    #[test]
    fn plain_image_is_rollback_mode() {
        let Some(path) = crate::rekordbox::library::tests::fixture() else {
            return;
        };
        let img = ok(decrypt(&std::fs::read(path).unwrap(), None));
        assert_eq!(&img[..16], b"SQLite format 3\0");
        assert_eq!((img[18], img[19]), (1, 1));
    }
}
