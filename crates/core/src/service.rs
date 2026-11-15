//! The loaded rekordbox library, kept current: manual `reload()` plus a debounced
//! file watcher on the source file (`master.db` / `master.db-wal`, or the XML export).

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use serde::{Deserialize, Serialize};

use crate::rekordbox::library::{self, Library};
use crate::rekordbox::location::{self, Location};
use crate::rekordbox::xml;
use crate::Error;

/// Where the library comes from.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Source {
    /// master.db as found via rekordbox's options.json.
    #[default]
    Auto,
    /// A specific master.db (settings override).
    MasterDb { path: PathBuf },
    /// A rekordbox XML export (`DJ_PLAYLISTS`), the fallback source.
    Xml { path: PathBuf },
}

/// One loaded state of the library. Cheap to share; replaced on every reload.
#[derive(Debug, Default)]
pub struct Snapshot {
    /// Last load error, if any. The library is then the last good one (or empty).
    pub error: Option<String>,
    pub library: Library,
    pub location: Option<Location>,
    pub source: Source,
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
    pub source: Source,
    pub track_count: usize,
    pub version: u64,
}

impl Snapshot {
    pub fn status(&self) -> Status {
        Status {
            error: self.error.clone(),
            location: self.location.clone(),
            playlist_count: self.library.playlists.len(),
            source: self.source.clone(),
            track_count: self.library.tracks.len(),
            version: self.version,
        }
    }
}

pub struct LibraryService {
    current: RwLock<Arc<Snapshot>>,
    source: RwLock<Source>,
    /// Serializes reloads so two never race to publish.
    reloading: Mutex<()>,
}

/// Quiet period after the last change before reloading (rekordbox writes in bursts).
const DEBOUNCE: Duration = Duration::from_millis(1500);

impl LibraryService {
    /// Create and load immediately (errors end up in the snapshot).
    pub fn new(source: Source) -> Arc<Self> {
        let s = Arc::new(Self {
            current: RwLock::new(Arc::new(Snapshot::default())),
            source: RwLock::new(source),
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

    /// Switch the library source and reload.
    pub fn set_source(&self, source: Source) -> Arc<Snapshot> {
        *self.source.write().unwrap_or_else(|e| e.into_inner()) = source;
        self.reload()
    }

    /// Re-locate and reload the library. On failure the previous library is kept and
    /// the error is reported in the snapshot.
    pub fn reload(&self) -> Arc<Snapshot> {
        let _guard = self.reloading.lock().unwrap_or_else(|e| e.into_inner());
        let prev = self.current();
        let source = self
            .source
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        let result = match &source {
            Source::Auto => location::locate(None),
            Source::MasterDb { path } => location::locate(Some(path)),
            Source::Xml { path } => Ok(Location {
                analysis_root: None,
                db_path: path.clone(),
                overridden: true,
            }),
        }
        .and_then(|loc| {
            let lib = match source {
                Source::Xml { .. } => xml::load(&loc.db_path),
                _ => library::load(&loc.db_path),
            };
            lib.map(|lib| (loc, lib))
        });
        let next = Arc::new(match result {
            Ok((loc, lib)) => Snapshot {
                error: None,
                library: lib,
                location: Some(loc),
                source,
                version: prev.version + 1,
            },
            // Keep everything consistent with the last good load; the failed attempt is
            // only reported through `error`.
            Err(e) => Snapshot {
                error: Some(e.to_string()),
                library: prev.library.clone(),
                location: prev.location.clone(),
                source: prev.source.clone(),
                version: prev.version,
            },
        });
        *self.current.write().unwrap_or_else(|e| e.into_inner()) = next.clone();
        next
    }

    /// Watch the current source file and reload after changes settle. `on_reload` is
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
        let dir = db
            .parent()
            .filter(|d| !d.as_os_str().is_empty())
            .unwrap_or(Path::new("."))
            .to_path_buf();
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
        let svc = LibraryService::new(Source::MasterDb { path: db.clone() });
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
    fn xml_source_and_switching_back() {
        let dir = std::env::temp_dir().join(format!("mixmap-svc-{}-xml", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let xml = dir.join("rekordbox.xml");
        std::fs::write(
            &xml,
            r#"<DJ_PLAYLISTS><COLLECTION><TRACK TrackID="1" Name="A" TotalTime="60"/></COLLECTION></DJ_PLAYLISTS>"#,
        )
        .unwrap();
        let svc = LibraryService::new(Source::Xml { path: xml.clone() });
        let snap = svc.current();
        assert_eq!(snap.error, None);
        assert_eq!(snap.library.tracks.len(), 1);
        assert_eq!(snap.status().source, Source::Xml { path: xml.clone() });

        let snap = svc.set_source(Source::Xml {
            path: dir.join("missing.xml"),
        });
        assert!(snap.error.is_some());
        assert_eq!(snap.library.tracks.len(), 1, "keeps the last good library");
        assert_eq!(
            snap.source,
            Source::Xml { path: xml.clone() },
            "and its source"
        );
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn watcher_reloads_after_change() {
        let Some(db) = copy_fixture("watch") else {
            return;
        };
        let svc = LibraryService::new(Source::MasterDb { path: db.clone() });
        let (tx, rx) = mpsc::channel();
        let watcher = svc.watch(move |s| tx.send(s.version).unwrap()).unwrap();
        // Unrelated files in the folder are ignored...
        std::fs::write(db.with_file_name("other.txt"), b"x").unwrap();
        assert!(rx.recv_timeout(Duration::from_secs(3)).is_err());
        // ...a burst of changes to master.db triggers a debounced reload. Windows can
        // deliver one late change event for the same writes, so allow at most one
        // extra reload, but no storm.
        let bytes = std::fs::read(&db).unwrap();
        for _ in 0..5 {
            std::fs::write(&db, &bytes).unwrap();
        }
        assert_eq!(rx.recv_timeout(Duration::from_secs(10)).unwrap(), 2);
        let extra = std::iter::from_fn(|| rx.recv_timeout(Duration::from_secs(3)).ok()).count();
        assert!(extra <= 1, "{extra} extra reloads after one burst");
        drop(watcher);
        std::fs::remove_dir_all(db.parent().unwrap()).ok();
    }
}
