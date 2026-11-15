//! MixMap's own data directories under `%APPDATA%\mixmap`.

use std::path::PathBuf;

/// `%APPDATA%\mixmap` (falls back to the current directory without APPDATA).
pub fn app_dir() -> PathBuf {
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

/// MixMap's own database.
pub fn database_path() -> PathBuf {
    app_dir().join("mixmap.db")
}
