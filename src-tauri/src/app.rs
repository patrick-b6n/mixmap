//! The backend behind every UI command: `App::call(command, args)` returns JSON (the
//! Tauri command `call` in lib.rs dispatches to it); events go out through an `Emit`
//! callback as Tauri events.

use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::Error;
use crate::artwork::{ArtworkCache, Size};
use crate::memory::calibration::{Loaded, Session};
use crate::network::exchange::UiReply;
use crate::network::paired::PairedStore;
use crate::network::{Discovery, SyncHub};
use crate::nowplaying::{Poller, Update};
use crate::service::{LibraryService, Source};

/// Sends an event to the UI: (name, JSON payload).
pub type Emit = Arc<dyn Fn(&'static str, Value) + Send + Sync>;

struct Network {
    /// Kept alive for the advertisement; dropping it unregisters from mDNS.
    _discovery: Option<Discovery>,
    error: Option<String>,
    hub: Arc<SyncHub>,
}

pub struct App {
    artwork: Arc<ArtworkCache>,
    calibration: Arc<Mutex<Option<Session>>>,
    emit: Emit,
    library: Arc<LibraryService>,
    network: Mutex<Option<Network>>,
    now_playing: Arc<Mutex<(Option<Update>, Option<Poller>)>>,
    ui_present: Mutex<Arc<dyn Fn() -> bool + Send + Sync>>,
    /// Keeps the master.db watcher alive.
    watcher: Mutex<Option<Box<dyn Send>>>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn to_value(v: impl Serialize) -> Result<Value, Error> {
    serde_json::to_value(v).map_err(|e| Error::Invalid(e.to_string()))
}

fn arg<T: for<'de> Deserialize<'de>>(args: Value) -> Result<T, Error> {
    serde_json::from_value(args).map_err(|e| Error::Invalid(format!("bad arguments: {e}")))
}

/// Run blocking work (I/O, scans, network) off the async runtime.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, Error> + Send + 'static,
) -> Result<T, Error> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| Error::Invalid(format!("task: {e}")))?
}

/// The whole library as one consistent snapshot.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LibraryData<'a> {
    histories: &'a [crate::rekordbox::playlists::Playlist],
    playlists: &'a [crate::rekordbox::playlists::Playlist],
    tracks: &'a [crate::rekordbox::library::Track],
    version: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PeerArg {
    peer_id: String,
}

impl App {
    pub fn new(source: Source, emit: Emit) -> Arc<Self> {
        let app = Arc::new(Self {
            artwork: Arc::new(ArtworkCache::new(crate::paths::artwork_dir())),
            calibration: Arc::default(),
            emit,
            library: LibraryService::new(source),
            network: Mutex::new(None),
            now_playing: Arc::default(),
            ui_present: Mutex::new(Arc::new(|| true)),
            watcher: Mutex::new(None),
        });
        app.rewatch();
        app
    }

    /// How to tell whether a UI listens for events (to answer sync requests).
    pub fn set_ui_presence(&self, f: Arc<dyn Fn() -> bool + Send + Sync>) {
        *lock(&self.ui_present) = f;
        if let Some(n) = lock(&self.network).as_ref() {
            let f = lock(&self.ui_present).clone();
            n.hub.set_ui_presence(Arc::new(move || f()));
        }
    }

    fn emit(&self, name: &'static str, payload: impl Serialize) {
        (self.emit)(name, serde_json::to_value(payload).unwrap_or(Value::Null));
    }

    /// Library status now (e.g. to resync a client that missed events).
    pub fn library_status(&self) -> Value {
        to_value(self.library.current().status()).unwrap_or(Value::Null)
    }

    /// (Re)start watching the current master.db; reloads are announced as `library`.
    fn rewatch(&self) {
        let emit = self.emit.clone();
        let watcher = self.library.watch(move |snap| {
            emit(
                "library",
                serde_json::to_value(snap.status()).unwrap_or(Value::Null),
            );
        });
        let new: Option<Box<dyn Send>> = match watcher {
            Ok(w) => Some(Box::new(w)),
            Err(e) => {
                eprintln!("not watching the library source: {e}");
                None
            }
        };
        let old = std::mem::replace(&mut *lock(&self.watcher), new);
        // Dropping a watcher joins its thread: do it outside the lock.
        drop(old);
    }

    /// Start the background parts: network sync (LAN listener + mDNS) and now-playing.
    pub async fn start_background(self: &Arc<Self>) {
        self.start_now_playing();
        self.prune_artwork();
        if let Err(e) = self.start_network().await {
            eprintln!("network sync disabled: {e}");
        }
    }

    /// Remove thumbnails no current track uses (in the background, only after a clean load).
    fn prune_artwork(&self) {
        let snap = self.library.current();
        if snap.error.is_some() || snap.library.tracks.is_empty() {
            return;
        }
        let cache = self.artwork.clone();
        std::thread::spawn(move || {
            let root = snap
                .location
                .as_ref()
                .and_then(|l| l.analysis_root.as_deref());
            let n = cache.prune(&snap.library.tracks, root);
            if n > 0 {
                println!("artwork cache: removed {n} unused thumbnails");
            }
        });
    }

    /// Unregister from mDNS and stop background work (on exit).
    pub fn shutdown(&self) {
        drop(lock(&self.network).take());
        drop(lock(&self.now_playing).1.take());
    }

    fn start_now_playing(&self) {
        let source = crate::memory::source::MemorySource::new(
            crate::memory::source::RekordboxProcess::default(),
            crate::paths::calibration_dir(),
        );
        let (emit, last) = (self.emit.clone(), self.now_playing.clone());
        let poller = Poller::start(
            Box::new(source),
            std::time::Duration::from_secs(1),
            move |u| {
                emit(
                    "now-playing",
                    serde_json::to_value(&u).unwrap_or(Value::Null),
                );
                lock(&last).0 = Some(u);
            },
        );
        lock(&self.now_playing).1 = Some(poller);
    }

    async fn start_network(self: &Arc<Self>) -> Result<(), Error> {
        let device = crate::network::identity::load_or_create(&crate::paths::device_path())?;
        let (listener, port) = crate::network::server::bind().await?;
        let emit = self.emit.clone();
        let hub = Arc::new(SyncHub::new(
            device.clone(),
            port,
            PairedStore::load(crate::paths::paired_path()),
            Arc::new(move |name, payload| emit(name, payload)),
        ));
        let present = lock(&self.ui_present).clone();
        hub.set_ui_presence(Arc::new(move || present()));
        let lan = hub.clone();
        tokio::spawn(async move {
            if let Err(e) = crate::network::server::serve(listener, lan).await {
                eprintln!("sync listener stopped: {e}");
            }
        });
        let (emit, seen) = (self.emit.clone(), hub.clone());
        let (discovery, error) = match Discovery::start(&device, port, move |peers| {
            seen.set_discovered(peers.clone());
            emit("peers", serde_json::to_value(&peers).unwrap_or(Value::Null));
        }) {
            Ok(d) => (Some(d), None),
            Err(e) => (None, Some(e.to_string())),
        };
        println!(
            "sync: {} ({}) on port {port}{}",
            device.name,
            device.id,
            error
                .as_ref()
                .map(|e| format!(", discovery off: {e}"))
                .unwrap_or_default()
        );
        *lock(&self.network) = Some(Network {
            _discovery: discovery,
            error,
            hub,
        });
        Ok(())
    }

    fn hub(&self) -> Result<Arc<SyncHub>, Error> {
        lock(&self.network)
            .as_ref()
            .map(|n| n.hub.clone())
            .ok_or_else(|| Error::NotFound("network sync is not running".into()))
    }

    /// Artwork thumbnail bytes (JPEG) for a track; None when it has none.
    pub async fn artwork(
        self: &Arc<Self>,
        track_id: String,
        size: Size,
    ) -> Result<Option<Vec<u8>>, Error> {
        let snap = self.library.current();
        let cache = self.artwork.clone();
        blocking(move || {
            let Some(track) = snap.library.tracks.iter().find(|t| t.id == track_id) else {
                return Ok(None);
            };
            let root = snap
                .location
                .as_ref()
                .and_then(|l| l.analysis_root.as_deref());
            match cache.thumbnail(track, root, size) {
                Some(path) => std::fs::read(path)
                    .map(Some)
                    .map_err(|e| Error::Invalid(format!("artwork: {e}"))),
                None => Ok(None),
            }
        })
        .await
    }

    /// Run a UI command. Unknown commands are `NotFound`.
    pub async fn call(self: &Arc<Self>, command: &str, args: Value) -> Result<Value, Error> {
        let app = self.clone();
        match command {
            "hello" => to_value(crate::hello()),
            "library" => {
                let snap = self.library.current();
                // Serializing a large library is CPU work.
                blocking(move || {
                    let lib = &snap.library;
                    to_value(LibraryData {
                        histories: &lib.histories,
                        playlists: &lib.playlists,
                        tracks: &lib.tracks,
                        version: snap.version,
                    })
                })
                .await
            }
            "library_status" => Ok(self.library_status()),
            "library_location" => to_value(crate::rekordbox::location::locate(None)?),
            "refresh" => {
                let status = blocking(move || Ok(app.library.reload().status())).await?;
                self.emit("library", &status);
                // The location may have changed (e.g. options.json now present).
                self.rewatch();
                to_value(status)
            }
            "set_library_source" => {
                #[derive(Deserialize)]
                struct A {
                    source: Source,
                }
                let a: A = arg(args)?;
                let status =
                    blocking(move || Ok(app.library.set_source(a.source).status())).await?;
                self.emit("library", &status);
                self.rewatch();
                to_value(status)
            }
            "write_backup" => {
                #[derive(Deserialize)]
                struct A {
                    content: String,
                    name: String,
                }
                let a: A = arg(args)?;
                let path = blocking(move || {
                    crate::backups::write_backup(&crate::paths::backups_dir(), &a.name, &a.content)
                })
                .await?;
                Ok(json!({ "path": path.display().to_string() }))
            }
            "sync_status" => Ok(match lock(&self.network).as_ref() {
                Some(n) => json!({
                    "device": n.hub.device,
                    "error": n.error,
                    "paired": n.hub.paired_peers(),
                    "peers": n.hub.discovered(),
                    "port": n.hub.port,
                }),
                None => json!({
                    "device": null,
                    "error": "network sync is not running",
                    "paired": [],
                    "peers": [],
                    "port": 0,
                }),
            }),
            "pair_start" => {
                let (hub, a) = (self.hub()?, arg::<PeerArg>(args)?);
                let name = blocking(move || hub.pair_start(&a.peer_id)).await?;
                Ok(json!({ "name": name }))
            }
            "pair_confirm" => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct A {
                    code: String,
                    peer_id: String,
                }
                let (hub, a) = (self.hub()?, arg::<A>(args)?);
                to_value(blocking(move || hub.pair_confirm(&a.peer_id, &a.code)).await?)
            }
            "unpair" => {
                let (hub, a) = (self.hub()?, arg::<PeerArg>(args)?);
                to_value(blocking(move || hub.unpair(&a.peer_id)).await?)
            }
            "sync_exchange" => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct A {
                    data: Value,
                    peer_id: String,
                }
                let (hub, a) = (self.hub()?, arg::<A>(args)?);
                blocking(move || hub.exchange(&a.peer_id, a.data)).await
            }
            "sync_reply" => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct A {
                    reply: UiReply,
                    request_id: String,
                }
                let (hub, a) = (self.hub()?, arg::<A>(args)?);
                blocking(move || hub.ui_reply(&a.request_id, a.reply)).await?;
                Ok(json!(true))
            }
            "now_playing" => to_value(lock(&self.now_playing).0.clone()),
            "calibration_start" => {
                use crate::memory::source::Attach;
                let (mem, version) =
                    blocking(|| crate::memory::source::RekordboxProcess::default().attach())
                        .await?;
                *lock(&self.calibration) = Some(Session::new(mem, version.clone()));
                Ok(json!({ "version": version }))
            }
            "calibration_round" => {
                #[derive(Deserialize)]
                struct A {
                    loaded: Vec<Loaded>,
                }
                let a: A = arg(args)?;
                let (cal, emit) = (self.calibration.clone(), self.emit.clone());
                to_value(
                    blocking(move || {
                        let mut guard = lock(&cal);
                        let session = guard
                            .as_mut()
                            .ok_or_else(|| Error::NotFound("start the calibration first".into()))?;
                        let mut last = std::time::Instant::now();
                        session.round(&a.loaded, |phase, done, total| {
                            // At most ~10 updates per second.
                            if last.elapsed().as_millis() >= 100 || done == total {
                                last = std::time::Instant::now();
                                emit(
                                    "calibration-progress",
                                    json!({ "done": done, "phase": phase, "total": total }),
                                );
                            }
                        })
                    })
                    .await?,
                )
            }
            "calibration_save" => {
                let cal = self.calibration.clone();
                let path = blocking(move || {
                    let mut guard = lock(&cal);
                    let c = guard
                        .as_ref()
                        .and_then(Session::calibration)
                        .ok_or_else(|| {
                            Error::Invalid(
                                "not calibrated yet: check another pair of tracks".into(),
                            )
                        })?;
                    let path =
                        crate::memory::calibration::save(&crate::paths::calibration_dir(), &c)?;
                    *guard = None;
                    Ok(path)
                })
                .await?;
                Ok(json!({ "path": path.display().to_string() }))
            }
            "calibration_cancel" => {
                *lock(&self.calibration) = None;
                Ok(json!(true))
            }
            other => Err(Error::NotFound(format!("unknown command {other}"))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app() -> Arc<App> {
        let events: Arc<Mutex<Vec<String>>> = Arc::default();
        let sink = events.clone();
        App::new(
            Source::Xml {
                path: std::path::PathBuf::from("does-not-exist.xml"),
            },
            Arc::new(move |name, _| lock(&sink).push(name.to_string())),
        )
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn dispatches_commands() {
        let app = app();
        assert!(app.call("hello", Value::Null).await.unwrap()["message"].is_string());
        let lib = app.call("library", Value::Null).await.unwrap();
        assert!(lib["tracks"].is_array());
        // Without network: a clear status, and pairing refuses.
        assert_eq!(
            app.call("sync_status", Value::Null).await.unwrap()["port"],
            0
        );
        assert!(
            app.call("pair_start", json!({"peerId": "x"}))
                .await
                .is_err()
        );
        assert!(matches!(
            app.call("nope", Value::Null).await,
            Err(Error::NotFound(_))
        ));
        assert!(matches!(
            app.call("set_library_source", json!({"nope": 1})).await,
            Err(Error::Invalid(_))
        ));
        assert_eq!(
            app.artwork("missing".into(), Size::Small).await.unwrap(),
            None
        );
    }
}
