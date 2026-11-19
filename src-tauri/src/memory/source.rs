//! The memory reader as a now-playing source: finds rekordbox, loads the calibration
//! for its version and reads each deck's title and artist through the saved chains.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::SystemTime;

use super::Memory;
use super::calibration::{self, Calibration};
use crate::Error;
use crate::nowplaying::{Deck, NowPlaying, NowPlayingSource};

/// Opens the rekordbox process (if running) and reports its version.
pub trait Attach: Send {
    fn attach(&mut self) -> Result<(Arc<dyn Memory>, String), Error>;
}

/// Windows: the real `rekordbox.exe`.
#[cfg(windows)]
#[derive(Default)]
pub struct RekordboxProcess {
    current: Option<(u32, Arc<dyn Memory>, String)>,
}

#[cfg(windows)]
impl Attach for RekordboxProcess {
    fn attach(&mut self) -> Result<(Arc<dyn Memory>, String), Error> {
        use super::process::{Process, find_pid};
        let pid = find_pid("rekordbox.exe")
            .ok_or_else(|| Error::NotFound("rekordbox is not running".into()))?;
        if let Some((p, mem, v)) = &self.current
            && *p == pid
        {
            return Ok((mem.clone(), v.clone()));
        }
        let process = Process::open(pid)?;
        let version = process.version().unwrap_or_else(|| "unknown".into());
        let mem: Arc<dyn Memory> = Arc::new(process);
        self.current = Some((pid, mem.clone(), version.clone()));
        Ok((mem, version))
    }
}

pub struct MemorySource<A: Attach> {
    attach: A,
    dir: PathBuf,
    loaded: Option<(Calibration, SystemTime)>,
}

impl<A: Attach> MemorySource<A> {
    /// `dir` holds the calibrations (one file per rekordbox version).
    pub fn new(attach: A, dir: PathBuf) -> Self {
        Self {
            attach,
            dir,
            loaded: None,
        }
    }
}

impl<A: Attach> NowPlayingSource for MemorySource<A> {
    fn name(&self) -> &'static str {
        "memory"
    }

    fn read(&mut self) -> Result<NowPlaying, Error> {
        let (mem, version) = self.attach.attach()?;
        // (Re)load when the version changed or a new calibration was saved.
        let fresh = calibration::modified(&self.dir, &version);
        let stale = match (&self.loaded, fresh) {
            (Some((c, t)), Some(f)) => c.version != version || *t != f,
            (_, None) => true,
            (None, Some(_)) => true,
        };
        if stale {
            self.loaded = calibration::load(&self.dir, &version);
        }
        let Some((cal, _)) = &self.loaded else {
            return Err(Error::NotFound(format!(
                "rekordbox {version} isn't calibrated yet: calibrate it (Settings → Now playing) or set tracks manually"
            )));
        };
        let decks = cal
            .decks
            .iter()
            .map(|d| Deck {
                artist: d
                    .artist
                    .as_ref()
                    .and_then(|f| f.read(mem.as_ref()))
                    .unwrap_or_default(),
                deck: d.deck,
                title: d.title.read(mem.as_ref()).unwrap_or_default(),
            })
            .collect::<Vec<_>>();
        if !decks.is_empty()
            && decks.iter().all(|d| d.title.is_empty())
            && cal
                .decks
                .iter()
                .all(|d| d.title.read(mem.as_ref()).is_none())
        {
            // Nothing resolves at all: most likely a different build with the same version.
            return Err(Error::NotFound(format!(
                "the calibration for rekordbox {version} no longer matches: recalibrate or set tracks manually"
            )));
        }
        Ok(NowPlaying {
            decks,
            master: None,
            source: String::new(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory::calibration::tests::Rekordbox;
    use crate::memory::calibration::{Loaded, Session, save};

    struct Fake(Option<Arc<Rekordbox>>);
    impl Attach for Fake {
        fn attach(&mut self) -> Result<(Arc<dyn Memory>, String), Error> {
            let rb = self
                .0
                .clone()
                .ok_or_else(|| Error::NotFound("rekordbox is not running".into()))?;
            Ok((rb, "7.2.19.0".into()))
        }
    }

    #[test]
    fn reads_decks_through_a_saved_calibration() {
        let dir = std::env::temp_dir().join(format!("mixmap-src-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let rb = Arc::new(Rekordbox::new());

        let mut down = MemorySource::new(Fake(None), dir.clone());
        assert!(down.read().unwrap_err().to_string().contains("not running"));
        let mut src = MemorySource::new(Fake(Some(rb.clone())), dir.clone());
        assert!(
            src.read()
                .unwrap_err()
                .to_string()
                .contains("isn't calibrated")
        );

        let mut s = Session::new(rb.clone(), "7.2.19.0".into());
        let l = |deck, title: &str, artist: &str| Loaded {
            artist: artist.into(),
            deck,
            title: title.into(),
        };
        rb.load(1, 0, "Ecstasy", "ATB");
        rb.load(2, 1, "San Andreas", "Caru");
        s.round(
            &[l(1, "Ecstasy", "ATB"), l(2, "San Andreas", "Caru")],
            |_, _, _| {},
        )
        .unwrap();
        rb.load(1, 2, "Latch", "Disclosure");
        rb.load(2, 3, "Cola", "CamelPhat");
        s.round(
            &[l(1, "Latch", "Disclosure"), l(2, "Cola", "CamelPhat")],
            |_, _, _| {},
        )
        .unwrap();
        save(&dir, &s.calibration().unwrap()).unwrap();

        rb.load(1, 4, "Problem", "Chase & Status");
        let np = src.read().unwrap();
        assert_eq!(
            np.decks
                .iter()
                .map(|d| (d.deck, d.title.as_str(), d.artist.as_str()))
                .collect::<Vec<_>>(),
            vec![(1, "Problem", "Chase & Status"), (2, "Cola", "CamelPhat")]
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
