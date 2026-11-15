//! Which deck is master: learned after the title calibration.
//!
//! The user switches the master deck in rekordbox between rounds (1, 2, 1, 2, …). Each
//! round reads the executable's whole image (static data) and the memory around every
//! object on the decks' title chains. A byte qualifies if it always has the same value
//! for the same master deck and different values for different ones. Filtering is
//! incremental, so only the first snapshot and the surviving bytes are kept.

use serde::{Deserialize, Serialize};

use super::calibration::Calibration;
use super::pointers::Chain;
use super::{read_lenient, Memory};
use crate::Error;

/// Bytes watched on each side of every object on a title chain.
const OBJECT_RADIUS: u64 = 0x8000;

/// Where the master deck is kept: one byte at `chain` + `offset` (an empty chain is a
/// static address), with the value seen for each deck.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct MasterField {
    pub chain: Chain,
    pub offset: i64,
    /// (byte value, deck number)
    pub values: Vec<(u8, u8)>,
}

impl MasterField {
    pub fn read(&self, mem: &dyn Memory) -> Option<u8> {
        let mut b = [0u8; 1];
        let at = self.chain.resolve(mem)?.checked_add_signed(self.offset)?;
        if !mem.read(at, &mut b) {
            return None;
        }
        self.values
            .iter()
            .find(|(v, _)| *v == b[0])
            .map(|(_, d)| *d)
    }
}

/// A watched range: `chain` resolves to an anchor; the window is `start..start+len`
/// relative to it.
#[derive(Clone, Debug, PartialEq)]
struct Window {
    chain: Chain,
    len: u64,
    start: i64,
}

fn windows(cal: &Calibration, module_size: u64) -> Vec<Window> {
    // The whole image: static data (anchor = module base).
    let mut out = vec![Window {
        chain: Chain {
            base: 0,
            offsets: vec![],
        },
        len: module_size,
        start: 0,
    }];
    let mut push = |chain: Chain| {
        let w = Window {
            chain,
            len: OBJECT_RADIUS * 2,
            start: -(OBJECT_RADIUS as i64),
        };
        if !out.contains(&w) {
            out.push(w);
        }
    };
    for d in &cal.decks {
        for f in std::iter::once(&d.title).chain(d.artist.as_ref()) {
            let Some(c) = f.chains.first() else { continue };
            // Every object along the chain: dereference k times, then offset 0.
            for k in 1..=c.offsets.len() {
                let mut offsets = c.offsets[..k - 1].to_vec();
                offsets.push(0);
                push(Chain {
                    base: c.base,
                    offsets,
                });
            }
        }
    }
    out
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MasterRound {
    /// Bytes still consistent with every round (before a second deck was master: all
    /// bytes that haven't changed).
    pub candidates: usize,
    pub rounds: usize,
    /// ≥ 4 rounds, each of ≥ 2 decks master at least twice, and a candidate left.
    pub ready: bool,
}

/// A surviving byte: window, index in it, and (deck, value) seen so far.
#[derive(Clone, Debug)]
struct Candidate {
    /// Value per round so far (None: window unreadable that round).
    history: Vec<Option<u8>>,
    index: u32,
    values: Vec<(u8, u8)>,
    window: usize,
}

/// Survivors are described in the log once there are at most this many.
const REPORT_LIMIT: usize = 30;

enum State {
    /// Only one deck was master so far: its snapshot, bytes changed since then marked.
    First {
        deck: u8,
        snaps: Vec<Option<(Vec<u8>, Vec<bool>)>>,
    },
    Filtering(Vec<Candidate>),
}

pub struct MasterSession {
    /// Candidates the last round removed (described, when there were few).
    dropped: Vec<String>,
    rounds: Vec<u8>,
    state: Option<State>,
    windows: Vec<Window>,
}

fn snapshot(mem: &dyn Memory, w: &Window) -> Option<Vec<u8>> {
    let anchor = w.chain.resolve(mem)?;
    let start = anchor.checked_add_signed(w.start)?;
    let mut buf = vec![0u8; w.len as usize];
    read_lenient(mem, start, &mut buf).then_some(buf)
}

impl MasterSession {
    pub fn new(cal: &Calibration, mem: &dyn Memory) -> Result<Self, Error> {
        if cal.decks.is_empty() {
            return Err(Error::Invalid("calibrate the deck titles first".into()));
        }
        Ok(Self {
            dropped: vec![],
            rounds: vec![],
            state: None,
            windows: windows(cal, mem.module().size),
        })
    }

    /// Record a round: `master` is the deck that is master in rekordbox right now.
    pub fn round(&mut self, mem: &dyn Memory, master: u8) -> MasterRound {
        let snaps: Vec<Option<Vec<u8>>> = self.windows.iter().map(|w| snapshot(mem, w)).collect();
        self.state = Some(match self.state.take() {
            None => State::First {
                deck: master,
                snaps: snaps
                    .into_iter()
                    .map(|s| {
                        s.map(|b| {
                            let n = b.len();
                            (b, vec![true; n])
                        })
                    })
                    .collect(),
            },
            Some(State::First {
                deck,
                snaps: mut first,
            }) if deck == master => {
                // Same master again: bytes that changed can't be the flag.
                for (f, s) in first.iter_mut().zip(&snaps) {
                    match (f.as_mut(), s) {
                        (Some((base, stable)), Some(now)) => {
                            for i in 0..base.len() {
                                if base[i] != now[i] {
                                    stable[i] = false;
                                }
                            }
                        }
                        (Some(_), None) => *f = None,
                        _ => {}
                    }
                }
                State::First { deck, snaps: first }
            }
            Some(State::First { deck, snaps: first }) => {
                // A different master: candidates are the stable bytes that changed.
                let mut cands = Vec::new();
                for (w, (f, s)) in first.iter().zip(&snaps).enumerate() {
                    let (Some((base, stable)), Some(now)) = (f, s) else {
                        continue;
                    };
                    for i in 0..base.len() {
                        if stable[i] && base[i] != now[i] {
                            cands.push(Candidate {
                                history: vec![Some(base[i]), Some(now[i])],
                                index: i as u32,
                                values: vec![(deck, base[i]), (master, now[i])],
                                window: w,
                            });
                        }
                    }
                }
                State::Filtering(cands)
            }
            Some(State::Filtering(mut cands)) => {
                let report = cands.len() <= REPORT_LIMIT;
                let mut dropped = Vec::new();
                let windows = &self.windows;
                cands.retain_mut(|c| {
                    // Unreadable this round (e.g. the object was just re-created): skip.
                    let Some(Some(now)) = snaps.get(c.window) else {
                        c.history.push(None);
                        return true;
                    };
                    let v = now[c.index as usize];
                    c.history.push(Some(v));
                    let keep = match c.values.iter().find(|(d, _)| *d == master) {
                        Some((_, old)) => *old == v,
                        None if c.values.iter().any(|(_, o)| *o == v) => false,
                        None => {
                            c.values.push((master, v));
                            true
                        }
                    };
                    if !keep && report {
                        dropped.push(describe(windows, c));
                    }
                    keep
                });
                self.dropped = dropped;
                State::Filtering(cands)
            }
        });
        self.rounds.push(master);
        self.result()
    }

    /// Diagnostics for the log: the survivors (when few) and what the last round removed.
    pub fn report(&self) -> Vec<String> {
        let mut out: Vec<String> = self
            .dropped
            .iter()
            .map(|d| format!("dropped: {d}"))
            .collect();
        let c = self.candidates();
        if c.len() <= REPORT_LIMIT {
            out.extend(
                c.iter()
                    .map(|c| format!("left: {}", describe(&self.windows, c))),
            );
        }
        out
    }

    fn candidates(&self) -> &[Candidate] {
        match &self.state {
            Some(State::Filtering(c)) => c,
            _ => &[],
        }
    }

    pub fn result(&self) -> MasterRound {
        let mut per_deck: Vec<(u8, usize)> = Vec::new();
        for d in &self.rounds {
            match per_deck.iter_mut().find(|(x, _)| x == d) {
                Some((_, n)) => *n += 1,
                None => per_deck.push((*d, 1)),
            }
        }
        let candidates = match &self.state {
            Some(State::First { snaps, .. }) => snaps
                .iter()
                .flatten()
                .map(|(_, stable)| stable.iter().filter(|s| **s).count())
                .sum(),
            _ => self.candidates().len(),
        };
        let filtering = matches!(self.state, Some(State::Filtering(_)));
        MasterRound {
            candidates,
            ready: filtering
                && self.rounds.len() >= 4
                && per_deck.iter().filter(|(_, n)| *n >= 2).count() >= 2
                && candidates > 0,
            rounds: self.rounds.len(),
        }
    }

    /// The best field, once `ready`: prefer a byte holding the deck number (1/2… or
    /// 0/1…), then a per-deck flag (0/1), then heap objects close to the deck strings.
    pub fn field(&self) -> Option<MasterField> {
        if !self.result().ready {
            return None;
        }
        let score = |c: &Candidate| {
            let v = &c.values;
            if v.iter().all(|(d, x)| x == d) {
                0
            } else if v.iter().all(|(d, x)| *x as u16 + 1 == *d as u16) {
                1
            } else if v.iter().all(|(_, x)| *x <= 1) {
                2
            } else {
                3
            }
        };
        let best = self.candidates().iter().min_by_key(|c| {
            let w = &self.windows[c.window];
            let distance = (w.start + c.index as i64).unsigned_abs();
            (score(c), w.chain.offsets.is_empty(), distance)
        })?;
        let w = &self.windows[best.window];
        Some(MasterField {
            chain: w.chain.clone(),
            offset: w.start + best.index as i64,
            values: best.values.iter().map(|(d, v)| (*v, *d)).collect(),
        })
    }
}

/// "module+0x1234" or "chain [base, o1, 0] -0x10", with the per-round values.
fn describe(windows: &[Window], c: &Candidate) -> String {
    let w = &windows[c.window];
    let at = w.start + c.index as i64;
    let place = if w.chain.offsets.is_empty() {
        format!("module+{:#x}", w.chain.base as i64 + at)
    } else {
        format!("chain {:#x} {:x?} {at:+#x}", w.chain.base, w.chain.offsets)
    };
    let hist: Vec<String> = c
        .history
        .iter()
        .map(|v| v.map_or("--".into(), |v| format!("{v:02x}")))
        .collect();
    format!("{place}: {}", hist.join(" "))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory::calibration::tests::Rekordbox;
    use crate::memory::calibration::{Loaded, Session};
    use std::sync::Arc;

    fn calibrated(rb: &Arc<Rekordbox>) -> Calibration {
        let l = |deck, title: &str| Loaded {
            artist: String::new(),
            deck,
            title: title.into(),
        };
        rb.load(1, 0, "Ecstasy", "ATB");
        rb.load(2, 1, "San Andreas", "Caru");
        let mut s = Session::new(rb.clone(), "v".into());
        s.round(&[l(1, "Ecstasy"), l(2, "San Andreas")], |_, _, _| {})
            .unwrap();
        rb.load(1, 2, "Latch", "x");
        rb.load(2, 3, "Cola", "y");
        s.round(&[l(1, "Latch"), l(2, "Cola")], |_, _, _| {})
            .unwrap();
        s.calibration().unwrap()
    }

    const HEAP: u64 = 0x1000_0000;
    const MODULE: u64 = 0x40_0000;

    #[test]
    fn learns_a_flag_near_the_deck_objects_and_ignores_noise() {
        let rb = Arc::new(Rekordbox::new());
        let cal = calibrated(&rb);
        // Each deck object keeps "is master" at +0x60; deck 1's object has a counter at
        // +0x70 that changes every round (noise).
        let set = |master: u8, tick: u8| {
            let mut m = rb.0.write().unwrap();
            m.write(HEAP + 0x100 + 0x60, &[u8::from(master == 1)]);
            m.write(HEAP + 0x300 + 0x60, &[u8::from(master == 2)]);
            m.write(HEAP + 0x100 + 0x70, &[tick]);
        };
        let mut ms = MasterSession::new(&cal, rb.as_ref()).unwrap();
        for (i, master) in [1u8, 1, 2, 1, 2].into_iter().enumerate() {
            set(master, i as u8 * 7);
            let r = ms.round(rb.as_ref(), master);
            assert_eq!(r.ready, i >= 4, "{r:?}");
        }
        let field = ms.field().unwrap();
        for master in [2u8, 1, 2] {
            set(master, 99);
            assert_eq!(field.read(rb.as_ref()), Some(master));
        }
    }

    #[test]
    fn finds_a_deck_number_in_static_data() {
        let rb = Arc::new(Rekordbox::new());
        let cal = calibrated(&rb);
        let set = |master: u8| rb.0.write().unwrap().write(MODULE + 0x900, &[master]);
        let mut ms = MasterSession::new(&cal, rb.as_ref()).unwrap();
        for master in [1u8, 2, 1, 2] {
            set(master);
            ms.round(rb.as_ref(), master);
        }
        let field = ms.field().unwrap();
        assert_eq!(field.chain.offsets, Vec::<u64>::new());
        assert_eq!(field.offset, 0x900);
        set(1);
        assert_eq!(field.read(rb.as_ref()), Some(1));
    }

    #[test]
    fn not_ready_without_both_decks_twice() {
        let rb = Arc::new(Rekordbox::new());
        let cal = calibrated(&rb);
        let mut ms = MasterSession::new(&cal, rb.as_ref()).unwrap();
        for m in [1, 1, 1, 2] {
            ms.round(rb.as_ref(), m);
        }
        assert!(!ms.result().ready);
        assert!(ms.field().is_none());
    }
}
