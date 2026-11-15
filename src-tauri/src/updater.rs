//! Self-update of the portable exe from GitHub Releases.
//!
//! `update_manifest` fetches `latest.json` of the latest release (the UI decides
//! whether it is newer). `update_install` downloads the exe from this repository's
//! releases only, checks size and SHA-256, renames the running exe to `*.old`, puts the
//! new one in its place and restarts. The `.old` file is removed on the next start.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

const REPO: &str = "patrick-b6n/mixmap";

fn manifest_url() -> String {
    format!("https://github.com/{REPO}/releases/latest/download/latest.json")
}

fn agent(timeout: Duration) -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(timeout))
        .user_agent("MixMap updater")
        .build()
        .into()
}

#[derive(Debug, Deserialize)]
pub struct Manifest {
    pub sha256: String,
    pub size: u64,
    pub url: String,
}

/// Only exe downloads from this repository's releases are allowed.
fn allowed(url: &str) -> bool {
    url.starts_with(&format!("https://github.com/{REPO}/releases/download/"))
        && url.ends_with("/MixMap.exe")
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Check a download against the manifest.
pub fn verify(bytes: &[u8], m: &Manifest) -> Result<(), String> {
    if bytes.len() as u64 != m.size {
        return Err(format!(
            "download has {} bytes, expected {}",
            bytes.len(),
            m.size
        ));
    }
    let sum = hex(&Sha256::digest(bytes));
    if !sum.eq_ignore_ascii_case(m.sha256.trim()) {
        return Err("download is corrupt (SHA-256 mismatch)".into());
    }
    // A Windows executable starts with "MZ".
    if !bytes.starts_with(b"MZ") {
        return Err("download is not a Windows program".into());
    }
    Ok(())
}

fn old_path(exe: &Path) -> PathBuf {
    exe.with_extension("exe.old")
}

/// Replace `exe` by `new_bytes`; the running file is renamed (Windows allows that) and
/// put back if anything fails.
pub fn swap(exe: &Path, new_bytes: &[u8]) -> Result<(), String> {
    let new = exe.with_extension("exe.new");
    let old = old_path(exe);
    std::fs::write(&new, new_bytes).map_err(|e| format!("cannot write {}: {e}", new.display()))?;
    let _ = std::fs::remove_file(&old);
    if let Err(e) = std::fs::rename(exe, &old) {
        let _ = std::fs::remove_file(&new);
        return Err(format!(
            "cannot replace {}: {e} (is the folder writable?)",
            exe.display()
        ));
    }
    if let Err(e) = std::fs::rename(&new, exe) {
        let _ = std::fs::rename(&old, exe);
        let _ = std::fs::remove_file(&new);
        return Err(format!("cannot replace {}: {e}", exe.display()));
    }
    Ok(())
}

/// Remove the previous exe left by an update (it may still be exiting: retry a while).
pub fn cleanup_old() {
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let old = old_path(&exe);
    if !old.exists() {
        return;
    }
    std::thread::spawn(move || {
        for _ in 0..20 {
            if std::fs::remove_file(&old).is_ok() || !old.exists() {
                return;
            }
            std::thread::sleep(Duration::from_millis(500));
        }
    });
}

/// `latest.json` of the newest release (null when there is none yet).
#[tauri::command]
pub async fn update_manifest() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut res = agent(Duration::from_secs(20))
            .get(manifest_url())
            .config()
            .http_status_as_error(false)
            .build()
            .call()
            .map_err(|e| format!("cannot reach GitHub: {e}"))?;
        match res.status().as_u16() {
            200 => res
                .body_mut()
                .read_json::<Value>()
                .map_err(|e| format!("bad latest.json: {e}")),
            404 => Ok(Value::Null),
            s => Err(format!("GitHub answered {s}")),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Download, verify, swap and restart. Returns only on failure.
#[tauri::command]
pub async fn update_install(app: tauri::AppHandle, manifest: Value) -> Result<(), String> {
    let m: Manifest = serde_json::from_value(manifest).map_err(|e| format!("bad manifest: {e}"))?;
    if !allowed(&m.url) {
        return Err(format!("refusing to download {}", m.url));
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe2 = exe.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = agent(Duration::from_secs(600))
            .get(&m.url)
            .call()
            .map_err(|e| format!("download failed: {e}"))?
            .body_mut()
            .with_config()
            .limit(500 * 1024 * 1024)
            .read_to_vec()
            .map_err(|e| format!("download failed: {e}"))?;
        verify(&bytes, &m)?;
        swap(&exe2, &bytes)
    })
    .await
    .map_err(|e| e.to_string())??;
    std::process::Command::new(&exe)
        .spawn()
        .map_err(|e| format!("updated, but could not restart: {e}"))?;
    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(bytes: &[u8]) -> Manifest {
        Manifest {
            sha256: hex(&Sha256::digest(bytes)),
            size: bytes.len() as u64,
            url: format!("https://github.com/{REPO}/releases/download/v2026.1115.1/MixMap.exe"),
        }
    }

    #[test]
    fn only_this_repositorys_release_exes() {
        assert!(allowed(&manifest(b"").url));
        assert!(!allowed("https://evil.example/MixMap.exe"));
        assert!(!allowed(&format!(
            "https://github.com/{REPO}/releases/download/v1/other.exe"
        )));
        assert!(!allowed(
            "https://github.com/someone/else/releases/download/v1/MixMap.exe"
        ));
    }

    #[test]
    fn verifies_size_hash_and_kind() {
        let good = b"MZ fake exe";
        assert!(verify(good, &manifest(good)).is_ok());
        assert!(verify(b"MZ other!!!", &manifest(good)).is_err());
        assert!(verify(b"MZ short", &manifest(good)).is_err());
        let not_exe = b"PK zip file";
        assert!(verify(not_exe, &manifest(not_exe))
            .unwrap_err()
            .contains("not a Windows program"));
    }

    #[test]
    fn swaps_files_and_keeps_the_old_one_aside() {
        let dir = std::env::temp_dir().join(format!("mixmap-swap-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let exe = dir.join("MixMap.exe");
        std::fs::write(&exe, b"old").unwrap();
        swap(&exe, b"new").unwrap();
        assert_eq!(std::fs::read(&exe).unwrap(), b"new");
        assert_eq!(std::fs::read(old_path(&exe)).unwrap(), b"old");
        assert!(!exe.with_extension("exe.new").exists());
        // A second update replaces the leftover .old.
        swap(&exe, b"newer").unwrap();
        assert_eq!(std::fs::read(old_path(&exe)).unwrap(), b"new");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
