//! mixmap's own data directories under `%APPDATA%\mixmap`.

use std::path::PathBuf;

/// `%APPDATA%\mixmap` (falls back to the current directory without APPDATA).
/// `MIXMAP_APP_DIR` overrides it (e.g. a second dev instance for sync tests). Debug
/// builds (`pnpm tauri dev`) default to `.dev-data/` in the repository, so development
/// never touches the real data (database, device identity, pairings).
pub fn app_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("MIXMAP_APP_DIR") {
        return PathBuf::from(dir);
    }
    if cfg!(debug_assertions) {
        return PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.dev-data");
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

/// Paired peers and their secrets (machine-local).
pub fn paired_path() -> PathBuf {
    app_dir().join("paired.json")
}

/// Memory-reader calibrations, one file per rekordbox version.
pub fn calibration_dir() -> PathBuf {
    app_dir().join("calibration")
}

/// mixmap's own database.
pub fn database_path() -> PathBuf {
    app_dir().join("mixmap.db")
}
