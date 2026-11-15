//! Pointer chains from the executable's static data to a string.
//!
//! A chain `[base, o1, …, on]` resolves as: `a = module + base; p = *a; a = p + o1;
//! p = *a; …; result = p + on` (every hop reads a 64-bit pointer, then adds an offset).
//! Heap addresses change every run; such chains don't, as long as the rekordbox build
//! stays the same.
//!
//! Finding them works backwards from the targets: level 1 are all aligned 64-bit
//! values in memory that point at (or a little before) a target, level 2 point at a
//! level-1 address, and so on, until an address lies inside the executable image.

use serde::{Deserialize, Serialize};

use super::{read_lenient, Memory};

#[derive(Clone, Debug, PartialEq, Eq, Hash, Deserialize, Serialize)]
pub struct Chain {
    /// Offset of the first pointer from the start of the executable image.
    pub base: u64,
    /// Offset added after each dereference (the last one gives the string address).
    pub offsets: Vec<u64>,
}

impl Chain {
    /// Follow the chain in `mem`; the resulting address, if every hop is readable.
    pub fn resolve(&self, mem: &dyn Memory) -> Option<u64> {
        let mut addr = mem.module().base.checked_add(self.base)?;
        for off in &self.offsets {
            let p = mem.read_u64(addr)?;
            if p == 0 {
                return None;
            }
            addr = p.checked_add(*off)?;
        }
        Some(addr)
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Options {
    /// Most dereferences in a chain.
    pub max_depth: usize,
    /// Largest offset added after a dereference (struct member / string header).
    pub max_offset: u64,
    /// Most addresses kept per level (smallest offsets first).
    pub max_per_level: usize,
    /// Most chains returned.
    pub max_chains: usize,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            max_depth: 5,
            max_offset: 0x800,
            max_per_level: 200_000,
            max_chains: 20_000,
        }
    }
}

/// One address on a level: it holds a pointer to `next` (index into the level below,
/// or into `targets` on level 1) minus `offset`.
#[derive(Clone, Copy)]
struct Node {
    addr: u64,
    next: usize,
    offset: u64,
}

const CHUNK: usize = 4 << 20;

/// Every aligned address in `mem` holding a value `v` with `t - max_offset <= v <= t` for
/// a `t` in `sorted` (ascending); one entry (address, index of t, t - v) per such `t`.
fn pointers_to(
    mem: &dyn Memory,
    sorted: &[u64],
    max_offset: u64,
    limit: usize,
) -> Vec<(u64, usize, u64)> {
    let mut out = Vec::new();
    if sorted.is_empty() {
        return out;
    }
    let (lo, hi) = (
        sorted[0].saturating_sub(max_offset),
        *sorted.last().unwrap(),
    );
    let mut buf = vec![0u8; CHUNK];
    for r in mem.regions() {
        let start = (r.base + 7) & !7;
        let end = r.base + r.size;
        let mut addr = start;
        while addr + 8 <= end {
            let len = ((end - addr) as usize).min(CHUNK) & !7;
            if len == 0 {
                break;
            }
            if read_lenient(mem, addr, &mut buf[..len]) {
                for (i, c) in buf[..len].as_chunks::<8>().0.iter().enumerate() {
                    let v = u64::from_le_bytes(*c);
                    if v < lo || v > hi {
                        continue;
                    }
                    // First target >= v; it is within reach if t - v <= max_offset.
                    // Every target within reach (a struct holds several strings).
                    let mut k = sorted.partition_point(|&t| t < v);
                    while k < sorted.len() && sorted[k] - v <= max_offset {
                        out.push((addr + i as u64 * 8, k, sorted[k] - v));
                        k += 1;
                    }
                }
            }
            addr += len as u64;
        }
        if out.len() > limit * 4 {
            break;
        }
    }
    out
}

/// Chains from the executable's image to any of `targets`.
pub fn find_chains(
    mem: &dyn Memory,
    targets: &[u64],
    opts: Options,
    mut progress: impl FnMut(usize, usize),
) -> Vec<(Chain, u64)> {
    let module = mem.module();
    let mut chains = Vec::new();
    // levels[0] = targets as nodes (next unused).
    let mut levels: Vec<Vec<Node>> = vec![targets
        .iter()
        .map(|&addr| Node {
            addr,
            next: usize::MAX,
            offset: 0,
        })
        .collect()];
    for depth in 1..=opts.max_depth {
        progress(depth, opts.max_depth);
        let below = &levels[depth - 1];
        // Search keys: addresses of the level below, sorted, remembering their index.
        let mut keyed: Vec<(u64, usize)> =
            below.iter().enumerate().map(|(i, n)| (n.addr, i)).collect();
        keyed.sort_unstable();
        keyed.dedup_by_key(|k| k.0);
        let sorted: Vec<u64> = keyed.iter().map(|k| k.0).collect();
        let mut found = pointers_to(mem, &sorted, opts.max_offset, opts.max_per_level);
        found.sort_by_key(|f| f.2);
        found.truncate(opts.max_per_level);
        let mut level = Vec::with_capacity(found.len());
        for (addr, k, offset) in found {
            let node = Node {
                addr,
                next: keyed[k].1,
                offset,
            };
            if module.contains(addr) {
                chains.push((
                    walk(&levels, depth, node, module.base),
                    levels[0][follow(&levels, depth, node)].addr,
                ));
                if chains.len() >= opts.max_chains {
                    return chains;
                }
            } else {
                level.push(node);
            }
        }
        if level.is_empty() {
            break;
        }
        levels.push(level);
    }
    chains
}

/// Build the chain for a static `node` found on `depth`.
fn walk(levels: &[Vec<Node>], depth: usize, node: Node, module_base: u64) -> Chain {
    let mut offsets = vec![node.offset];
    let mut next = node.next;
    for d in (1..depth).rev() {
        let n = levels[d][next];
        offsets.push(n.offset);
        next = n.next;
    }
    Chain {
        base: node.addr - module_base,
        offsets,
    }
}

/// Index of the target (level 0) a node leads to.
fn follow(levels: &[Vec<Node>], depth: usize, node: Node) -> usize {
    let mut next = node.next;
    for d in (1..depth).rev() {
        next = levels[d][next].next;
    }
    next
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory::fake::FakeMemory;
    use crate::memory::{read_string, Encoding, Region};

    /// module (static) → struct A (+0x10) → struct B (+0x28) → string (+0x18 header)
    fn world() -> FakeMemory {
        let mut m = FakeMemory::default();
        m.block(0x40_0000, 0x1000); // the executable image
        m.module = Some(Region {
            base: 0x40_0000,
            size: 0x1000,
        });
        m.block(0x1000_0000, 0x1000); // heap
        m.write_u64(0x40_0100, 0x1000_0000); // static → A
        m.write_u64(0x1000_0010, 0x1000_0200); // A+0x10 → B
        m.write_u64(0x1000_0228, 0x1000_0400); // B+0x28 → string object
        m.write(0x1000_0418, b"Ecstasy\0"); // chars after a 0x18 header
                                            // A decoy copy of the title nobody points to from static data.
        m.write(0x1000_0800, b"Ecstasy\0");
        m
    }

    #[test]
    fn finds_the_chain_and_resolves_it() {
        let m = world();
        let targets = crate::memory::scan::find_strings(&m, "Ecstasy", Encoding::Utf8, |_, _| {});
        assert_eq!(targets, vec![0x1000_0418, 0x1000_0800]);
        let chains = find_chains(&m, &targets, Options::default(), |_, _| {});
        let expected = Chain {
            base: 0x100,
            offsets: vec![0x10, 0x28, 0x18],
        };
        let hit = chains
            .iter()
            .find(|(c, _)| *c == expected)
            .expect("chain found");
        assert_eq!(hit.1, 0x1000_0418);
        assert_eq!(expected.resolve(&m), Some(0x1000_0418));
        assert_eq!(
            read_string(&m, expected.resolve(&m).unwrap(), Encoding::Utf8).as_deref(),
            Some("Ecstasy")
        );
        // With tight offsets the decoy isn't reachable from static data (with wide ones
        // it may be; calibration rounds weed such chains out).
        let tight = Options {
            max_offset: 0x100,
            ..Options::default()
        };
        let chains = find_chains(&m, &targets, tight, |_, _| {});
        assert!(chains.iter().any(|(c, _)| *c == expected));
        assert!(chains.iter().all(|(_, t)| *t != 0x1000_0800));
    }

    #[test]
    fn a_chain_follows_a_new_string() {
        let mut m = world();
        // The deck now shows another track: B points at a new string object.
        m.write(0x1000_0918, b"San Andreas\0");
        m.write_u64(0x1000_0228, 0x1000_0900);
        let chain = Chain {
            base: 0x100,
            offsets: vec![0x10, 0x28, 0x18],
        };
        let at = chain.resolve(&m).unwrap();
        assert_eq!(
            read_string(&m, at, Encoding::Utf8).as_deref(),
            Some("San Andreas")
        );
    }

    #[test]
    fn respects_depth_and_unreadable_hops() {
        let m = world();
        let shallow = Options {
            max_depth: 2,
            max_offset: 0x100,
            ..Options::default()
        };
        assert!(find_chains(&m, &[0x1000_0418], shallow, |_, _| {}).is_empty());
        let broken = Chain {
            base: 0x100,
            offsets: vec![0x10, 0x900, 0],
        };
        assert_eq!(broken.resolve(&m), None);
    }
}
