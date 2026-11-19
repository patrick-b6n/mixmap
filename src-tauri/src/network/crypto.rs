//! Pairing and request signing.
//!
//! Pairing: both sides exchange ephemeral X25519 public keys; the target shows a
//! random 6-digit code; the shared secret is HMAC(DH result, code ‖ ids ‖ keys).
//! Each side proves it knows the secret before it is stored, so a wrong code (or a
//! man in the middle without the code) never yields a pairing.
//!
//! Requests between paired peers are signed with HMAC-SHA256 over method, path,
//! timestamp and body hash (see `signature`); the secret itself never travels.

use hmac::{Hmac, KeyInit, Mac};
use sha2::{Digest, Sha256};

type HmacSha256 = Hmac<Sha256>;

/// Fresh random 32 bytes.
pub fn random_bytes() -> [u8; 32] {
    let mut b = [0u8; 32];
    getrandom::fill(&mut b).expect("OS random number generator");
    b
}

/// Random 6-digit pairing code, e.g. "042917".
pub fn random_code() -> String {
    let b = random_bytes();
    let n = u32::from_le_bytes([b[0], b[1], b[2], b[3]]) % 1_000_000;
    format!("{n:06}")
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn unhex<const N: usize>(s: &str) -> Option<[u8; N]> {
    if s.len() != N * 2 || !s.is_ascii() {
        return None;
    }
    let mut out = [0u8; N];
    for (i, o) in out.iter_mut().enumerate() {
        *o = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some(out)
}

fn mac(key: &[u8], parts: &[&[u8]]) -> [u8; 32] {
    let mut m = HmacSha256::new_from_slice(key).expect("HMAC accepts any key length");
    for p in parts {
        // Length-prefixed, so ("ab","c") and ("a","bc") differ.
        m.update(&(p.len() as u64).to_le_bytes());
        m.update(p);
    }
    m.finalize().into_bytes().into()
}

/// What both sides know after the key exchange. `a` started the pairing, `b` shows the code.
#[derive(Clone)]
pub struct Handshake {
    pub id_a: String,
    pub id_b: String,
    pub public_a: [u8; 32],
    pub public_b: [u8; 32],
    pub shared: [u8; 32],
}

impl Handshake {
    /// The long-term pairing secret for `code`.
    pub fn secret(&self, code: &str) -> [u8; 32] {
        mac(
            &self.shared,
            &[
                b"mixmap-pair-v1",
                code.as_bytes(),
                self.id_a.as_bytes(),
                self.id_b.as_bytes(),
                &self.public_a,
                &self.public_b,
            ],
        )
    }
}

/// Proof that a side knows `secret`; `role` is "a" or "b" so proofs can't be reflected.
pub fn proof(secret: &[u8; 32], role: &str) -> [u8; 32] {
    mac(secret, &[b"mixmap-pair-confirm", role.as_bytes()])
}

/// Constant-time comparison.
pub fn same(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Signature of a request or response between paired peers.
pub fn signature(
    secret: &[u8; 32],
    method: &str,
    path: &str,
    time_ms: u64,
    body: &[u8],
) -> [u8; 32] {
    let body_hash: [u8; 32] = Sha256::digest(body).into();
    mac(
        secret,
        &[
            b"mixmap-sync-v1",
            method.as_bytes(),
            path.as_bytes(),
            &time_ms.to_le_bytes(),
            &body_hash,
        ],
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use x25519_dalek::{EphemeralSecret, PublicKey};

    fn handshake() -> (Handshake, Handshake) {
        let (sa, sb) = (EphemeralSecret::random(), EphemeralSecret::random());
        let (pa, pb) = (PublicKey::from(&sa), PublicKey::from(&sb));
        let a = Handshake {
            id_a: "A".into(),
            id_b: "B".into(),
            public_a: pa.to_bytes(),
            public_b: pb.to_bytes(),
            shared: sa.diffie_hellman(&pb).to_bytes(),
        };
        let b = Handshake {
            shared: sb.diffie_hellman(&pa).to_bytes(),
            ..a.clone()
        };
        (a, b)
    }

    #[test]
    fn same_code_same_secret_other_code_other_secret() {
        let (a, b) = handshake();
        assert_eq!(a.secret("123456"), b.secret("123456"));
        assert_ne!(a.secret("123456"), b.secret("123457"));
        let s = a.secret("123456");
        assert!(same(&proof(&s, "a"), &proof(&b.secret("123456"), "a")));
        assert!(!same(&proof(&s, "a"), &proof(&s, "b")));
    }

    #[test]
    fn codes_and_hex() {
        for _ in 0..50 {
            let c = random_code();
            assert_eq!(c.len(), 6);
            assert!(c.chars().all(|ch| ch.is_ascii_digit()));
        }
        let b = random_bytes();
        assert_eq!(unhex::<32>(&hex(&b)), Some(b));
        assert_eq!(unhex::<2>("zz00"), None);
        assert_eq!(unhex::<2>("abc"), None);
    }

    #[test]
    fn signatures_cover_everything() {
        let k = random_bytes();
        let s = signature(&k, "POST", "/sync/x", 5, b"body");
        assert_ne!(s, signature(&k, "POST", "/sync/x", 6, b"body"));
        assert_ne!(s, signature(&k, "POST", "/sync/y", 5, b"body"));
        assert_ne!(s, signature(&k, "POST", "/sync/x", 5, b"bodY"));
        assert_ne!(s, signature(&random_bytes(), "POST", "/sync/x", 5, b"body"));
    }
}
