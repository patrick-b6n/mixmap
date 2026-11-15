//! MixMap's own data directories under `%APPDATA%\mixmap`.

use std::path::PathBuf;

/// `%APPDATA%\mixmap` (falls back to the current directory without APPDATA).
/// `MIXMAP_APP_DIR` overrides it (e.g. a second dev instance for sync tests).
pub fn app_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("MIXMAP_APP_DIR") {
        return PathBuf::from(dir);
    }
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_default()
        .join("mixmap")
}

/// Thumbnail cache.
pub fn artwork_dir() -> PathBuf {
    app_dir().join("artwork")
}

/// Automatic backups (before import "replace" and reset).
pub fn backups_dir() -> PathBuf {
    app_dir().join("backups")
}

/// This instance's network identity.
pub fn device_path() -> PathBuf {
    app_dir().join("device.json")
}

/// MixMap's own database.
pub fn database_path() -> PathBuf {
    app_dir().join("mixmap.db")
}
