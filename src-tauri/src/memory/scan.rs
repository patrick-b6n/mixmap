//! Find every occurrence of a byte string in readable memory.

use super::{Encoding, Memory, read_lenient};

/// Bytes read per step; consecutive chunks overlap by the needle length.
const CHUNK: usize = 4 << 20;

/// Addresses where `needle` occurs, in every region. `progress` gets
/// (bytes scanned, total bytes).
pub fn find_all(mem: &dyn Memory, needle: &[u8], mut progress: impl FnMut(u64, u64)) -> Vec<u64> {
    if needle.is_empty() {
        return vec![];
    }
    let regions = mem.regions();
    let total: u64 = regions.iter().map(|r| r.size).sum();
    let mut done = 0u64;
    let mut hits = Vec::new();
    let mut buf = Vec::new();
    let finder = memchr::memmem::Finder::new(needle);
    for r in regions {
        let mut off = 0u64;
        while off < r.size {
            let len = (CHUNK as u64 + needle.len() as u64 - 1).min(r.size - off) as usize;
            buf.resize(len, 0);
            if read_lenient(mem, r.base + off, &mut buf) {
                for at in finder.find_iter(&buf) {
                    // Overlapping tail is scanned again by the next chunk: skip it here.
                    if (at as u64) < CHUNK as u64 || off + CHUNK as u64 >= r.size {
                        hits.push(r.base + off + at as u64);
                    }
                }
            }
            off += CHUNK as u64;
        }
        done += r.size;
        progress(done, total);
    }
    hits.sort_unstable();
    hits.dedup();
    hits
}

/// Occurrences of a text that are whole NUL-terminated strings (not a substring of a
/// longer text), in the given encoding.
pub fn find_strings(
    mem: &dyn Memory,
    text: &str,
    enc: Encoding,
    progress: impl FnMut(u64, u64),
) -> Vec<u64> {
    let mut needle = enc.encode(text);
    // Require the terminator so "Intro" doesn't match "Introduction".
    needle.extend(match enc {
        Encoding::Utf8 => &[0u8][..],
        Encoding::Utf16 => &[0u8, 0][..],
    });
    find_all(mem, &needle, progress)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory::fake::FakeMemory;

    #[test]
    fn finds_whole_strings_in_both_encodings() {
        let mut m = FakeMemory::default();
        m.block(0x1000, 0x400);
        m.block(0x10_0000, 0x400);
        m.write(0x1010, b"Intro\0");
        m.write(0x1100, b"Introduction\0");
        let mut u16 = Encoding::Utf16.encode("Intro");
        u16.extend([0, 0]);
        m.write(0x10_0020, &u16);
        let mut seen = 0;
        assert_eq!(
            find_strings(&m, "Intro", Encoding::Utf8, |d, t| {
                seen += 1;
                assert!(d <= t);
            }),
            vec![0x1010]
        );
        assert_eq!(seen, 2);
        assert_eq!(
            find_strings(&m, "Intro", Encoding::Utf16, |_, _| {}),
            vec![0x10_0020]
        );
    }

    #[test]
    fn finds_matches_across_chunk_boundaries() {
        let mut m = FakeMemory::default();
        m.block(0, CHUNK * 2 + 64);
        let at = CHUNK as u64 - 3;
        m.write(at, b"abcdef\0");
        m.write(10, b"abcdef\0");
        assert_eq!(find_all(&m, b"abcdef\0", |_, _| {}), vec![10, at]);
    }
}
