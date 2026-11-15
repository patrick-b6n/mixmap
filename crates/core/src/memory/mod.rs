//! Reading what rekordbox shows on its decks straight from its process memory
//! (read-only). Strings are found by scanning; pointer chains from the executable's
//! static data to those strings are derived during calibration and stored per
//! rekordbox version, so later reads are a handful of pointer hops.

pub mod calibration;
pub mod master;
pub mod pointers;
#[cfg(windows)]
pub mod process;
pub mod scan;
pub mod source;

/// A readable range of another process's address space.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Region {
    pub base: u64,
    pub size: u64,
}

impl Region {
    pub fn contains(&self, addr: u64) -> bool {
        addr >= self.base && addr - self.base < self.size
    }
}

/// Read access to some memory: a real process, or a fake in tests.
pub trait Memory: Send + Sync {
    /// Committed, readable regions to scan (heap and the executable image).
    fn regions(&self) -> Vec<Region>;
    /// Copy `buf.len()` bytes from `addr`; false if (part of) it isn't readable.
    fn read(&self, addr: u64, buf: &mut [u8]) -> bool;
    /// The main executable's image: pointer chains start in its static data.
    fn module(&self) -> Region;

    fn read_u64(&self, addr: u64) -> Option<u64> {
        let mut b = [0u8; 8];
        self.read(addr, &mut b).then(|| u64::from_le_bytes(b))
    }
}

/// Read `buf.len()` bytes at `addr`; if the whole read fails (memory changing under
/// us, a hole), read 4 KiB pages one by one and zero the unreadable ones. Returns
/// false only if nothing at all could be read.
pub fn read_lenient(mem: &dyn Memory, addr: u64, buf: &mut [u8]) -> bool {
    if mem.read(addr, buf) {
        return true;
    }
    const PAGE: u64 = 4096;
    let mut any = false;
    let mut pos = 0usize;
    while pos < buf.len() {
        let a = addr + pos as u64;
        let len = ((PAGE - a % PAGE) as usize).min(buf.len() - pos);
        if mem.read(a, &mut buf[pos..pos + len]) {
            any = true;
        } else {
            buf[pos..pos + len].fill(0);
        }
        pos += len;
    }
    any
}

/// How a string is stored.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Encoding {
    Utf8,
    Utf16,
}

impl Encoding {
    /// The bytes of `s` in this encoding, without terminator.
    pub fn encode(self, s: &str) -> Vec<u8> {
        match self {
            Encoding::Utf8 => s.as_bytes().to_vec(),
            Encoding::Utf16 => s.encode_utf16().flat_map(u16::to_le_bytes).collect(),
        }
    }

    /// A NUL-terminated string at the start of `bytes`, if it is valid and terminated.
    pub fn decode(self, bytes: &[u8]) -> Option<String> {
        match self {
            Encoding::Utf8 => {
                let end = bytes.iter().position(|&b| b == 0)?;
                String::from_utf8(bytes[..end].to_vec()).ok()
            }
            Encoding::Utf16 => {
                let units: Vec<u16> = bytes
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .map(|c| u16::from_le_bytes(*c))
                    .collect();
                let end = units.iter().position(|&u| u == 0)?;
                String::from_utf16(&units[..end]).ok()
            }
        }
    }
}

/// Read a NUL-terminated string at `addr` (at most 1 KiB).
pub fn read_string(mem: &dyn Memory, addr: u64, enc: Encoding) -> Option<String> {
    // Try a large read first, then smaller ones near the end of a region.
    for len in [1024usize, 256, 64] {
        let mut buf = vec![0u8; len];
        if mem.read(addr, &mut buf) {
            if let Some(s) = enc.decode(&buf) {
                return Some(s);
            }
        }
    }
    None
}

#[cfg(test)]
pub mod fake {
    use super::*;
    use std::collections::BTreeMap;

    /// Memory made of byte blocks at fixed addresses; block 0 is "the module".
    #[derive(Default)]
    pub struct FakeMemory {
        pub blocks: BTreeMap<u64, Vec<u8>>,
        pub module: Option<Region>,
    }

    impl FakeMemory {
        pub fn block(&mut self, base: u64, size: usize) {
            self.blocks.insert(base, vec![0; size]);
        }
        pub fn write(&mut self, addr: u64, bytes: &[u8]) {
            let (&base, block) = self
                .blocks
                .range_mut(..=addr)
                .next_back()
                .expect("block for address");
            let off = (addr - base) as usize;
            block[off..off + bytes.len()].copy_from_slice(bytes);
        }
        pub fn write_u64(&mut self, addr: u64, v: u64) {
            self.write(addr, &v.to_le_bytes());
        }
    }

    impl Memory for FakeMemory {
        fn regions(&self) -> Vec<Region> {
            self.blocks
                .iter()
                .map(|(&base, b)| Region {
                    base,
                    size: b.len() as u64,
                })
                .collect()
        }
        fn read(&self, addr: u64, buf: &mut [u8]) -> bool {
            let Some((&base, block)) = self.blocks.range(..=addr).next_back() else {
                return false;
            };
            let off = (addr - base) as usize;
            if off + buf.len() > block.len() {
                return false;
            }
            buf.copy_from_slice(&block[off..off + buf.len()]);
            true
        }
        fn module(&self) -> Region {
            self.module.expect("module set")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodings_round_trip_and_need_a_terminator() {
        for enc in [Encoding::Utf8, Encoding::Utf16] {
            let mut b = enc.encode("Café – Ü");
            assert_eq!(enc.decode(&b), None);
            b.extend([0, 0]);
            assert_eq!(enc.decode(&b).as_deref(), Some("Café – Ü"));
        }
    }
}
