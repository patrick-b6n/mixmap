//! Calibration: learn where rekordbox keeps the title (and artist) of each deck.
//!
//! Round 1: the user loads known tracks on the decks; every occurrence of those
//! strings is found and all pointer chains from static data to them are collected.
//! Further rounds (other tracks loaded) keep only the chains that now lead to the new
//! strings. What survives is saved per rekordbox version.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use super::pointers::{Chain, Options, find_chains};
use super::scan::find_strings;
use super::{Encoding, Memory, read_string};
use crate::Error;

/// Chains kept per field in a saved calibration (shortest first).
const KEEP: usize = 8;

/// How to read one string (a title or an artist).
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Field {
    pub chains: Vec<Chain>,
    pub encoding: Encoding,
}

impl Field {
    /// The first chain that leads to a readable string.
    pub fn read(&self, mem: &dyn Memory) -> Option<String> {
        self.chains
            .iter()
            .find_map(|c| read_string(mem, c.resolve(mem)?, self.encoding))
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct DeckFields {
    pub artist: Option<Field>,
    pub deck: u8,
    pub title: Field,
}

/// A saved calibration for one rekordbox build.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Calibration {
    pub decks: Vec<DeckFields>,
    pub version: String,
}

fn file(dir: &Path, version: &str) -> PathBuf {
    let safe: String = version
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' {
                c
            } else {
                '_'
            }
        })
        .collect();
    dir.join(format!("rekordbox-{safe}.json"))
}

pub fn save(dir: &Path, c: &Calibration) -> Result<PathBuf, Error> {
    std::fs::create_dir_all(dir).map_err(|e| Error::Invalid(e.to_string()))?;
    let path = file(dir, &c.version);
    let json = serde_json::to_vec_pretty(c).map_err(|e| Error::Invalid(e.to_string()))?;
    std::fs::write(&path, json)
        .map_err(|e| Error::Invalid(format!("cannot write {}: {e}", path.display())))?;
    Ok(path)
}

/// The calibration for `version`, and the file's modification time (to notice updates).
pub fn load(dir: &Path, version: &str) -> Option<(Calibration, std::time::SystemTime)> {
    let path = file(dir, version);
    let modified = std::fs::metadata(&path).and_then(|m| m.modified()).ok()?;
    let c: Calibration = serde_json::from_slice(&std::fs::read(&path).ok()?).ok()?;
    Some((c, modified))
}

pub fn modified(dir: &Path, version: &str) -> Option<std::time::SystemTime> {
    std::fs::metadata(file(dir, version))
        .and_then(|m| m.modified())
        .ok()
}

/// What the user says is loaded on a deck in this round.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Loaded {
    pub artist: String,
    pub deck: u8,
    pub title: String,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
enum Kind {
    Title,
    Artist,
}

/// Candidates left after a round, per deck.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeckCount {
    pub artist: usize,
    pub deck: u8,
    pub title: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoundResult {
    pub decks: Vec<DeckCount>,
    pub rounds: usize,
    /// Enough to save: ≥ 2 rounds and a title chain for every deck.
    pub ready: bool,
}

pub struct Session {
    candidates: HashMap<(u8, Kind), Vec<(Chain, Encoding)>>,
    decks: Vec<u8>,
    mem: Arc<dyn Memory>,
    pub options: Options,
    rounds: usize,
    version: String,
}

impl Session {
    pub fn new(mem: Arc<dyn Memory>, version: String) -> Self {
        Self {
            candidates: HashMap::new(),
            decks: vec![],
            mem,
            options: Options::default(),
            rounds: 0,
            version,
        }
    }

    /// Run a round. `progress(phase, done, total)` reports long scans.
    pub fn round(
        &mut self,
        loaded: &[Loaded],
        mut progress: impl FnMut(&str, u64, u64),
    ) -> Result<RoundResult, Error> {
        if loaded.is_empty() {
            return Err(Error::Invalid("load tracks on at least one deck".into()));
        }
        let mut titles: Vec<&str> = loaded.iter().map(|l| l.title.trim()).collect();
        titles.sort_unstable();
        if titles.iter().any(|t| t.is_empty()) || titles.windows(2).any(|w| w[0] == w[1]) {
            return Err(Error::Invalid(
                "every deck needs a different track (titles must differ)".into(),
            ));
        }
        if self.rounds == 0 {
            self.first_round(loaded, &mut progress);
        } else {
            let decks: Vec<u8> = loaded.iter().map(|l| l.deck).collect();
            if decks != self.decks {
                return Err(Error::Invalid(
                    "use the same decks as in the first round".into(),
                ));
            }
            let mem = self.mem.clone();
            for l in loaded {
                for (kind, want) in [(Kind::Title, &l.title), (Kind::Artist, &l.artist)] {
                    if let Some(list) = self.candidates.get_mut(&(l.deck, kind)) {
                        list.retain(|(c, enc)| {
                            c.resolve(mem.as_ref())
                                .and_then(|a| read_string(mem.as_ref(), a, *enc))
                                .is_some_and(|s| s == want.trim())
                        });
                    }
                }
            }
        }
        self.rounds += 1;
        Ok(self.result())
    }

    fn first_round(&mut self, loaded: &[Loaded], progress: &mut impl FnMut(&str, u64, u64)) {
        self.decks = loaded.iter().map(|l| l.deck).collect();
        // Every occurrence of every string, remembering what it is.
        let mut owner: HashMap<u64, (u8, Kind, Encoding)> = HashMap::new();
        let jobs: Vec<(u8, Kind, &str)> = loaded
            .iter()
            .flat_map(|l| {
                [
                    (l.deck, Kind::Title, l.title.trim()),
                    (l.deck, Kind::Artist, l.artist.trim()),
                ]
            })
            .filter(|j| !j.2.is_empty())
            .collect();
        for (i, (deck, kind, text)) in jobs.iter().enumerate() {
            for enc in [Encoding::Utf8, Encoding::Utf16] {
                for a in find_strings(self.mem.as_ref(), text, enc, |d, t| {
                    progress(
                        "Searching for the track names",
                        i as u64 * t + d,
                        jobs.len() as u64 * t,
                    )
                }) {
                    owner.insert(a, (*deck, *kind, enc));
                }
            }
        }
        let targets: Vec<u64> = owner.keys().copied().collect();
        let chains = find_chains(self.mem.as_ref(), &targets, self.options, |d, t| {
            progress("Following pointers", d as u64, t as u64)
        });
        for (chain, target) in chains {
            if let Some(&(deck, kind, enc)) = owner.get(&target) {
                self.candidates
                    .entry((deck, kind))
                    .or_default()
                    .push((chain, enc));
            }
        }
    }

    pub fn result(&self) -> RoundResult {
        let count = |d: u8, k: Kind| self.candidates.get(&(d, k)).map_or(0, Vec::len);
        let decks: Vec<DeckCount> = self
            .decks
            .iter()
            .map(|&d| DeckCount {
                artist: count(d, Kind::Artist),
                deck: d,
                title: count(d, Kind::Title),
            })
            .collect();
        RoundResult {
            ready: self.rounds >= 2 && decks.iter().all(|d| d.title > 0),
            decks,
            rounds: self.rounds,
        }
    }

    /// The calibration to save (shortest chains first), once `ready`.
    pub fn calibration(&self) -> Option<Calibration> {
        if !self.result().ready {
            return None;
        }
        let field = |d: u8, k: Kind| -> Option<Field> {
            let list = self.candidates.get(&(d, k))?;
            let enc = list.first()?.1;
            let mut chains: Vec<Chain> = list
                .iter()
                .filter(|(_, e)| *e == enc)
                .map(|(c, _)| c.clone())
                .collect();
            chains.sort_by_key(|c| (c.offsets.len(), c.offsets.iter().sum::<u64>()));
            chains.truncate(KEEP);
            Some(Field {
                chains,
                encoding: enc,
            })
        };
        Some(Calibration {
            decks: self
                .decks
                .iter()
                .map(|&d| DeckFields {
                    artist: field(d, Kind::Artist),
                    deck: d,
                    title: field(d, Kind::Title).expect("ready implies a title"),
                })
                .collect(),
            version: self.version.clone(),
        })
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::memory::Region;
    use crate::memory::fake::FakeMemory;
    use std::sync::RwLock;

    /// Fake "rekordbox": static deck table → deck objects → title/artist string objects.
    pub(crate) struct Rekordbox(pub RwLock<FakeMemory>);

    impl Memory for Rekordbox {
        fn regions(&self) -> Vec<Region> {
            self.0.read().unwrap().regions()
        }
        fn read(&self, addr: u64, buf: &mut [u8]) -> bool {
            self.0.read().unwrap().read(addr, buf)
        }
        fn module(&self) -> Region {
            self.0.read().unwrap().module()
        }
    }

    const MODULE: u64 = 0x40_0000;
    const HEAP: u64 = 0x1000_0000;

    impl Rekordbox {
        pub(crate) fn new() -> Self {
            let mut m = FakeMemory::default();
            m.block(MODULE, 0x1000);
            m.module = Some(Region {
                base: MODULE,
                size: 0x1000,
            });
            m.block(HEAP, 0x10000);
            // static table at +0x200: pointers to deck objects 1 and 2.
            m.write_u64(MODULE + 0x200, HEAP + 0x100);
            m.write_u64(MODULE + 0x208, HEAP + 0x300);
            Self(RwLock::new(m))
        }

        /// Load a track: new UTF-16 strings at fresh addresses, deck object updated.
        pub(crate) fn load(&self, deck: u8, slot: u64, title: &str, artist: &str) {
            let mut m = self.0.write().unwrap();
            let obj = if deck == 1 {
                HEAP + 0x100
            } else {
                HEAP + 0x300
            };
            let (t, a) = (HEAP + 0x1000 + slot * 0x400, HEAP + 0x1200 + slot * 0x400);
            let mut tb = Encoding::Utf16.encode(title);
            tb.extend([0, 0]);
            let mut ab = Encoding::Utf16.encode(artist);
            ab.extend([0, 0]);
            m.write(t + 0x10, &tb);
            m.write(a + 0x10, &ab);
            m.write_u64(obj + 0x40, t);
            m.write_u64(obj + 0x48, a);
            // The library list keeps its own copies (decoys) nobody static points to.
            m.write(HEAP + 0x8000 + slot * 0x200, &tb);
        }
    }

    fn loaded(deck: u8, title: &str, artist: &str) -> Loaded {
        Loaded {
            artist: artist.into(),
            deck,
            title: title.into(),
        }
    }

    #[test]
    fn calibrates_over_rounds_and_reads_new_tracks() {
        let rb = Arc::new(Rekordbox::new());
        rb.load(1, 0, "Ecstasy", "ATB");
        rb.load(2, 1, "San Andreas", "Caru");
        let mut s = Session::new(rb.clone(), "7.2.19.0".into());
        let r1 = s
            .round(
                &[
                    loaded(1, "Ecstasy", "ATB"),
                    loaded(2, "San Andreas", "Caru"),
                ],
                |_, _, _| {},
            )
            .unwrap();
        assert!(!r1.ready && r1.decks.iter().all(|d| d.title > 0));
        rb.load(1, 2, "Latch", "Disclosure");
        rb.load(2, 3, "Cola", "CamelPhat");
        let r2 = s
            .round(
                &[
                    loaded(1, "Latch", "Disclosure"),
                    loaded(2, "Cola", "CamelPhat"),
                ],
                |_, _, _| {},
            )
            .unwrap();
        assert!(r2.ready, "{r2:?}");
        let cal = s.calibration().unwrap();
        assert_eq!(cal.decks[0].title.encoding, Encoding::Utf16);

        // A third, unseen pair of tracks is read correctly.
        rb.load(1, 4, "Problem", "Chase & Status");
        rb.load(2, 5, "Everyday", "Rusko");
        let read = |d: usize| {
            (
                cal.decks[d].title.read(rb.as_ref()),
                cal.decks[d]
                    .artist
                    .as_ref()
                    .and_then(|f| f.read(rb.as_ref())),
            )
        };
        assert_eq!(
            read(0),
            (Some("Problem".into()), Some("Chase & Status".into()))
        );
        assert_eq!(read(1), (Some("Everyday".into()), Some("Rusko".into())));

        // Saved and loaded per version.
        let dir = std::env::temp_dir().join(format!("mixmap-cal-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        save(&dir, &cal).unwrap();
        assert_eq!(load(&dir, "7.2.19.0").unwrap().0, cal);
        assert!(load(&dir, "7.3.0.0").is_none());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rejects_bad_rounds() {
        let rb = Arc::new(Rekordbox::new());
        let mut s = Session::new(rb, "x".into());
        assert!(s.round(&[], |_, _, _| {}).is_err());
        assert!(
            s.round(&[loaded(1, "A", ""), loaded(2, "A", "")], |_, _, _| {})
                .is_err()
        );
    }
}
