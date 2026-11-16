//! Now-playing detection: what is loaded on each rekordbox deck and which deck is
//! master. Sources (the memory reader, tests) implement `NowPlayingSource`; a poller
//! runs the active source and reports changes. Matching titles to library tracks and
//! combining with manual mode happen in the UI (`ui/src/domain/nowPlaying.ts`).

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::JoinHandle;
use std::time::Duration;

use serde::Serialize;

use crate::Error;

/// One deck as a source sees it. Empty title = nothing loaded.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Deck {
    pub artist: String,
    /// 1-based deck number.
    pub deck: u8,
    pub title: String,
}

/// A snapshot from a source.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    pub decks: Vec<Deck>,
    /// Master deck, if the source knows it.
    pub master: Option<u8>,
    /// Which source produced it ("memory", …).
    pub source: String,
}

/// Something that can tell what rekordbox is playing.
pub trait NowPlayingSource: Send {
    /// Short id, e.g. "memory".
    fn name(&self) -> &'static str;
    /// Read the current state. `Err` means the source can't work right now (e.g.
    /// rekordbox not running, unsupported version); the message is shown to the user.
    fn read(&mut self) -> Result<NowPlaying, Error>;
}

/// What the poller reports: a snapshot or why there is none.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum Update {
    Ok(NowPlaying),
    Unavailable { source: String, reason: String },
}

/// Runs a source every `interval` on its own thread and calls `on_change` whenever the
/// result differs from the previous one. Stops when dropped.
pub struct Poller {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Poller {
    pub fn start(
        mut source: Box<dyn NowPlayingSource>,
        interval: Duration,
        on_change: impl Fn(Update) + Send + 'static,
    ) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let thread = std::thread::Builder::new()
            .name("now-playing".into())
            .spawn(move || {
                let mut last: Option<Update> = None;
                while !flag.load(Ordering::Relaxed) {
                    let update = match source.read() {
                        Ok(mut np) => {
                            np.source = source.name().into();
                            np.decks.sort_by_key(|d| d.deck);
                            Update::Ok(np)
                        }
                        Err(e) => Update::Unavailable {
                            reason: e.to_string(),
                            source: source.name().into(),
                        },
                    };
                    if last.as_ref() != Some(&update) {
                        on_change(update.clone());
                        last = Some(update);
                    }
                    // Sleep in small steps so dropping the poller is quick.
                    let mut slept = Duration::ZERO;
                    while slept < interval && !flag.load(Ordering::Relaxed) {
                        let step = Duration::from_millis(50).min(interval - slept);
                        std::thread::sleep(step);
                        slept += step;
                    }
                }
            })
            .expect("spawn now-playing thread");
        Self {
            stop,
            thread: Some(thread),
        }
    }
}

impl Drop for Poller {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, mpsc};

    /// Replays a script of results, then repeats the last one.
    struct Script(Arc<Mutex<Vec<Result<NowPlaying, Error>>>>);

    impl NowPlayingSource for Script {
        fn name(&self) -> &'static str {
            "script"
        }
        fn read(&mut self) -> Result<NowPlaying, Error> {
            let mut v = self.0.lock().unwrap();
            if v.len() > 1 {
                v.remove(0)
            } else {
                match &v[0] {
                    Ok(np) => Ok(np.clone()),
                    Err(e) => Err(Error::Invalid(e.to_string())),
                }
            }
        }
    }

    fn deck(n: u8, title: &str) -> Deck {
        Deck {
            artist: "A".into(),
            deck: n,
            title: title.into(),
        }
    }

    #[test]
    fn reports_only_changes_sorted_and_tagged() {
        let np = |decks: Vec<Deck>, master| NowPlaying {
            decks,
            master,
            source: String::new(),
        };
        let script = vec![
            Err(Error::NotFound("rekordbox is not running".into())),
            Ok(np(vec![deck(2, "B"), deck(1, "A")], Some(1))),
            Ok(np(vec![deck(1, "A"), deck(2, "B")], Some(1))),
            Ok(np(vec![deck(1, "A"), deck(2, "B")], Some(2))),
        ];
        let (tx, rx) = mpsc::channel();
        let poller = Poller::start(
            Box::new(Script(Arc::new(Mutex::new(script)))),
            Duration::from_millis(5),
            move |u| {
                let _ = tx.send(u);
            },
        );
        let got: Vec<Update> = (0..3)
            .map(|_| rx.recv_timeout(Duration::from_secs(2)).unwrap())
            .collect();
        drop(poller);
        assert_eq!(
            got[0],
            Update::Unavailable {
                reason: "rekordbox is not running".into(),
                source: "script".into()
            }
        );
        let Update::Ok(first) = &got[1] else { panic!() };
        assert_eq!(first.source, "script");
        assert_eq!(
            first.decks.iter().map(|d| d.deck).collect::<Vec<_>>(),
            [1, 2]
        );
        // The reordered duplicate was not reported; the master change was.
        let Update::Ok(second) = &got[2] else {
            panic!()
        };
        assert_eq!(second.master, Some(2));
        assert!(rx.recv_timeout(Duration::from_millis(50)).is_err());
    }
}
