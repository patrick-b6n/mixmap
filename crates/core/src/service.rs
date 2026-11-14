//! The loaded rekordbox library, kept current: manual `reload()` plus a debounced
//! file watcher on `master.db` / `master.db-wal`.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use serde::Serialize;

use crate::rekordbox::library::{self, Library};
use crate::rekordbox::location::{self, Location};
use crate::Error;

/// One loaded state of the library. Cheap to share; replaced on every reload.
#[derive(Debug, Default)]
pub struct Snapshot {
    /// Last load error, if any. The library is then the last good one (or empty).
    pub error: Option<String>,
    pub library: Library,
    pub location: Option<Location>,
    /// Increases with every successful load.
    pub version: u64,
}

/// Small summary for the UI's status line.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub error: Option<String>,
    pub location: Option<Location>,
    pub playlist_count: usize,
    pub track_count: usize,
    pub version: u64,
}

impl Snapshot {
    pub fn status(&self) -> Status {
        Status {
            error: self.error.clone(),
            location: self.location.clone(),
            playlist_count: self.library.playlists.len(),
            track_count: self.library.tracks.len(),
            version: self.version,
        }
    }
}

pub struct LibraryService {
    current: RwLock<Arc<Snapshot>>,
    db_override: RwLock<Option<PathBuf>>,
    /// Serializes reloads so two never race to publish.
    reloading: Mutex<()>,
}

/// Quiet period after the last change before reloading (rekordbox writes in bursts).
const DEBOUNCE: Duration = Duration::from_millis(1500);

impl LibraryService {
    /// Create and load immediately (errors end up in the snapshot).
    pub fn new(db_override: Option<PathBuf>) -> Arc<Self> {
        let s = Arc::new(Self {
            current: RwLock::new(Arc::new(Snapshot::default())),
            db_override: RwLock::new(db_override),
            reloading: Mutex::new(()),
        });
        s.reload();
        s
    }

    pub fn current(&self) -> Arc<Snapshot> {
        self.current
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// Change the settings override and reload.
    pub fn set_db_override(&self, path: Option<PathBuf>) -> Arc<Snapshot> {
        *self.db_override.write().unwrap_or_else(|e| e.into_inner()) = path;
        self.reload()
    }

    /// Re-locate and reload the library. On failure the previous library is kept and
    /// the error is reported in the snapshot.
    pub fn reload(&self) -> Arc<Snapshot> {
        let _guard = self.reloading.lock().unwrap_or_else(|e| e.into_inner());
        let prev = self.current();
        let db_override = self
            .db_override
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        let result = location::locate(db_override.as_deref())
            .and_then(|loc| library::load(&loc.db_path).map(|lib| (loc, lib)));
        let next = Arc::new(match result {
            Ok((loc, lib)) => Snapshot {
                error: None,
                library: lib,
                location: Some(loc),
                version: prev.version + 1,
            },
            Err(e) => Snapshot {
                error: Some(e.to_string()),
                library: prev.library.clone(),
                location: prev.location.clone(),
                version: prev.version,
            },
        });
        *self.current.write().unwrap_or_else(|e| e.into_inner()) = next.clone();
        next
    }

    /// Watch the current `master.db` and reload after changes settle. `on_reload` is
    /// called (on the watcher thread) with every new snapshot. Keep the returned
    /// watcher alive; dropping it stops watching. Call again after the location changes.
    pub fn watch(
        self: &Arc<Self>,
        on_reload: impl Fn(Arc<Snapshot>) + Send + 'static,
    ) -> Result<Debouncer<RecommendedWatcher>, Error> {
        let db = self
            .current()
            .location
            .as_ref()
            .map(|l| l.db_path.clone())
            .ok_or_else(|| Error::NotFound("no rekordbox library to watch".into()))?;
        let dir = db.parent().unwrap_or(Path::new(".")).to_path_buf();
        let name = lower_name(&db);
        let wal = format!("{name}-wal");
        let me = Arc::downgrade(self);
        let watch_err = |e: &dyn std::fmt::Display| {
            Error::Invalid(format!("cannot watch {}: {e}", dir.display()))
        };
        let mut debouncer = new_debouncer(DEBOUNCE, move |res: DebounceEventResult| {
            let Ok(events) = res else { return };
            let relevant = events.iter().any(|e| {
                let f = lower_name(&e.path);
                f == name || f == wal
            });
            if let (true, Some(me)) = (relevant, me.upgrade()) {
                on_reload(me.reload());
            }
        })
        .map_err(|e| watch_err(&e))?;
        debouncer
            .watcher()
            .watch(&dir, RecursiveMode::NonRecursive)
            .map_err(|e| watch_err(&e))?;
        Ok(debouncer)
    }
}

fn lower_name(p: &Path) -> String {
    p.file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    fn copy_fixture(name: &str) -> Option<PathBuf> {
        let src = crate::rekordbox::library::tests::fixture()?;
        let dir = std::env::temp_dir().join(format!("mixmap-svc-{}-{name}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("master.db");
        std::fs::copy(src, &db).unwrap();
        Some(db)
    }

    #[test]
    fn reload_keeps_last_good_library_on_error() {
        let Some(db) = copy_fixture("reload") else {
            return;
        };
        let svc = LibraryService::new(Some(db.clone()));
        let first = svc.current();
        assert_eq!(first.version, 1, "{:?}", first.error);
        assert!(!first.library.tracks.is_empty());

        std::fs::write(&db, b"broken").unwrap();
        let after = svc.reload();
        assert!(after.error.is_some());
        assert_eq!(after.version, 1);
        assert_eq!(after.library.tracks.len(), first.library.tracks.len());
        std::fs::remove_dir_all(db.parent().unwrap()).ok();
    }

    #[test]
    fn watcher_reloads_after_change() {
        let Some(db) = copy_fixture("watch") else {
            return;
        };
        let svc = LibraryService::new(Some(db.clone()));
        let (tx, rx) = mpsc::channel();
        let watcher = svc.watch(move |s| tx.send(s.version).unwrap()).unwrap();
        // Unrelated files in the folder are ignored...
        std::fs::write(db.with_file_name("other.txt"), b"x").unwrap();
        assert!(rx.recv_timeout(Duration::from_secs(3)).is_err());
        // ...a burst of changes to master.db triggers one debounced reload.
        let bytes = std::fs::read(&db).unwrap();
        std::fs::write(&db, &bytes).unwrap();
        std::fs::write(&db, &bytes).unwrap();
        assert_eq!(rx.recv_timeout(Duration::from_secs(10)).unwrap(), 2);
        assert!(rx.recv_timeout(Duration::from_secs(3)).is_err());
        drop(watcher);
        std::fs::remove_dir_all(db.parent().unwrap()).ok();
    }
}
