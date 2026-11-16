//! Self-update of the portable exe from GitHub Releases (docs/release.md).
//!
//! 1. `update_check`: `GET /repos/{REPO}/releases/latest` and a SemVer comparison of
//!    its tag (`v<CalVer>`) with the running version.
//! 2. `update_install`: asks GitHub again (never trusts URLs from the WebView),
//!    downloads `mixmap.exe.sha256` and `mixmap.exe` of that release, checks size and
//!    SHA-256, renames the running exe to `*.old` (Windows allows renaming a running
//!    image, not overwriting it), puts the new one in its place and restarts.
//! 3. The next start removes the `.old` file ([`cleanup_old`]).
//!
//! Until the swap nothing next to the exe changes but `*.new`, which is removed on
//! every failure: the old version stays intact. Debug builds refuse to install.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// The public repository the releases come from.
const REPO: &str = "patrick-b6n/mixmap";
/// The release asset that is the app.
const EXE_ASSET: &str = "mixmap.exe";
/// Its checksum, one line in `sha256sum` format.
const CHECKSUM_ASSET: &str = "mixmap.exe.sha256";
/// Upper bound for the downloaded exe.
const MAX_EXE_SIZE: u64 = 500 * 1024 * 1024;
/// Upper bound for the checksum file.
const MAX_CHECKSUM_SIZE: u64 = 4096;

fn agent(timeout: Duration) -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(timeout))
        // No personal data: GitHub only requires some User-Agent.
        .user_agent("mixmap updater")
        .build()
        .into()
}

// --- GitHub API (only the fields used) ---

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    #[serde(default)]
    name: Option<String>,
    html_url: String,
    #[serde(default)]
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Clone, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
    size: u64,
}

/// Result of [`update_check`], sent to the WebView.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    /// Version of the running app (`0.0.0` in development).
    pub current_version: String,
    /// Version of the latest release (its tag without `v`), `None` without releases.
    pub latest_version: Option<String>,
    /// The release's title, e.g. "2026-11-16 08:21:26 UTC".
    pub title: Option<String>,
    /// The release page (release notes).
    pub release_url: Option<String>,
    /// Whether the latest release is newer than the running app. Never for
    /// development builds (`0.0.0`).
    pub update_available: bool,
}

// --- Pure logic (unit-tested) ---

/// `v2026.1116.82126` → `2026.1116.82126`; `None` for anything that is no version.
fn tag_version(tag: &str) -> Option<semver::Version> {
    semver::Version::parse(tag.strip_prefix('v')?).ok()
}

/// Whether `latest` is newer than `current`. A development build (`0.0.0`, or any
/// unparsable version) never updates.
fn is_newer(latest: &semver::Version, current: &str) -> bool {
    match semver::Version::parse(current) {
        Ok(current) if current > semver::Version::new(0, 0, 0) => *latest > current,
        _ => false,
    }
}

fn check(release: Option<&GithubRelease>, current: &str) -> UpdateCheck {
    let latest = release.and_then(|r| tag_version(&r.tag_name));
    UpdateCheck {
        current_version: current.to_string(),
        latest_version: latest.as_ref().map(ToString::to_string),
        title: release.map(|r| r.name.clone().unwrap_or_else(|| r.tag_name.clone())),
        release_url: release.map(|r| r.html_url.clone()),
        update_available: latest.as_ref().is_some_and(|l| is_newer(l, current)),
    }
}

/// Only downloads of this repository's releases are allowed.
fn allowed(url: &str) -> bool {
    url.starts_with(&format!("https://github.com/{REPO}/releases/download/"))
}

/// The exe and checksum assets of a release, both from this repository.
fn assets(release: &GithubRelease) -> Result<(&GithubAsset, &GithubAsset), String> {
    let find = |name: &str| {
        release
            .assets
            .iter()
            .find(|a| a.name == name)
            .filter(|a| allowed(&a.browser_download_url))
            .ok_or_else(|| format!("release {} has no {name}", release.tag_name))
    };
    let (exe, checksum) = (find(EXE_ASSET)?, find(CHECKSUM_ASSET)?);
    if exe.size == 0 || exe.size > MAX_EXE_SIZE || checksum.size > MAX_CHECKSUM_SIZE {
        return Err(format!(
            "release {} has unexpected asset sizes",
            release.tag_name
        ));
    }
    Ok((exe, checksum))
}

/// The hash from a `sha256sum` line (`<hex>  mixmap.exe`).
fn parse_checksum(text: &str) -> Result<String, String> {
    let line = text.lines().next().unwrap_or_default();
    let mut parts = line.split_whitespace();
    let hash = parts.next().unwrap_or_default();
    let name = parts.next().map(|n| n.trim_start_matches('*'));
    if hash.len() != 64 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("bad checksum file".into());
    }
    if name.is_some_and(|n| n != EXE_ASSET) {
        return Err(format!("checksum file is for {}", name.unwrap_or_default()));
    }
    Ok(hash.to_ascii_lowercase())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Check a download against the expected size and SHA-256.
fn verify(bytes: &[u8], size: u64, sha256: &str) -> Result<(), String> {
    if bytes.len() as u64 != size {
        return Err(format!(
            "download has {} bytes, expected {size}",
            bytes.len()
        ));
    }
    if !hex(&Sha256::digest(bytes)).eq_ignore_ascii_case(sha256) {
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
fn swap(exe: &Path, new_bytes: &[u8]) -> Result<(), String> {
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

// --- I/O ---

/// The latest release; `None` when there is none yet.
fn latest_release() -> Result<Option<GithubRelease>, String> {
    let mut res = agent(Duration::from_secs(20))
        .get(format!(
            "https://api.github.com/repos/{REPO}/releases/latest"
        ))
        .header("Accept", "application/vnd.github+json")
        .config()
        .http_status_as_error(false)
        .build()
        .call()
        .map_err(|e| format!("cannot reach GitHub: {e}"))?;
    match res.status().as_u16() {
        200 => res
            .body_mut()
            .read_json::<GithubRelease>()
            .map(Some)
            .map_err(|e| format!("unexpected answer from GitHub: {e}")),
        404 => Ok(None),
        s => Err(format!("GitHub answered {s}")),
    }
}

fn download(url: &str, limit: u64, timeout: Duration) -> Result<Vec<u8>, String> {
    agent(timeout)
        .get(url)
        .call()
        .map_err(|e| format!("download failed: {e}"))?
        .body_mut()
        .with_config()
        .limit(limit)
        .read_to_vec()
        .map_err(|e| format!("download failed: {e}"))
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

/// Whether the latest release is newer than the running app.
#[tauri::command]
pub async fn update_check(app: tauri::AppHandle) -> Result<UpdateCheck, String> {
    let current = app.package_info().version.to_string();
    tauri::async_runtime::spawn_blocking(move || Ok(check(latest_release()?.as_ref(), &current)))
        .await
        .map_err(|e| e.to_string())?
}

/// Download, verify, swap and restart. Returns only on failure.
#[tauri::command]
pub async fn update_install(app: tauri::AppHandle) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Err("development builds never replace themselves".into());
    }
    let current = app.package_info().version.to_string();
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe2 = exe.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let release = latest_release()?.ok_or("there is no release")?;
        if !check(Some(&release), &current).update_available {
            return Err("there is no newer version".into());
        }
        let (exe_asset, checksum_asset) = assets(&release)?;
        let checksum = download(
            &checksum_asset.browser_download_url,
            MAX_CHECKSUM_SIZE,
            Duration::from_secs(60),
        )?;
        let sha256 = parse_checksum(&String::from_utf8_lossy(&checksum))?;
        let bytes = download(
            &exe_asset.browser_download_url,
            MAX_EXE_SIZE,
            Duration::from_secs(600),
        )?;
        verify(&bytes, exe_asset.size, &sha256)?;
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

    fn asset(name: &str, size: u64) -> GithubAsset {
        GithubAsset {
            name: name.into(),
            browser_download_url: format!(
                "https://github.com/{REPO}/releases/download/v2026.1116.82126/{name}"
            ),
            size,
        }
    }

    fn release(tag: &str) -> GithubRelease {
        GithubRelease {
            tag_name: tag.into(),
            name: Some("2026-11-16 08:21:26 UTC".into()),
            html_url: format!("https://github.com/{REPO}/releases/tag/{tag}"),
            assets: vec![asset(EXE_ASSET, 100), asset(CHECKSUM_ASSET, 77)],
        }
    }

    #[test]
    fn offers_only_newer_releases_and_never_to_dev_builds() {
        let r = release("v2026.1116.82126");
        let c = check(Some(&r), "2026.1116.81227");
        assert!(c.update_available);
        assert_eq!(c.latest_version.as_deref(), Some("2026.1116.82126"));
        assert_eq!(c.title.as_deref(), Some("2026-11-16 08:21:26 UTC"));
        assert!(!check(Some(&r), "2026.1116.82126").update_available);
        assert!(!check(Some(&r), "2026.1117.0").update_available);
        assert!(!check(Some(&r), "0.0.0").update_available);
        assert!(!check(Some(&release("nightly")), "2026.1116.0").update_available);
        let none = check(None, "2026.1116.0");
        assert!(!none.update_available && none.latest_version.is_none());
    }

    #[test]
    fn takes_assets_from_this_repository_only() {
        let mut r = release("v2026.1116.82126");
        assert!(assets(&r).is_ok());
        r.assets[0].browser_download_url = "https://evil.example/mixmap.exe".into();
        assert!(assets(&r).is_err());
        let mut r = release("v2026.1116.82126");
        r.assets.pop();
        assert!(assets(&r).unwrap_err().contains(CHECKSUM_ASSET));
        let mut r = release("v2026.1116.82126");
        r.assets[1].size = MAX_CHECKSUM_SIZE + 1;
        assert!(assets(&r).is_err());
    }

    #[test]
    fn parses_sha256sum_lines() {
        let hash = "AB".repeat(32);
        assert_eq!(
            parse_checksum(&format!("{hash}  mixmap.exe\n")).unwrap(),
            hash.to_lowercase()
        );
        assert!(parse_checksum(&format!("{hash} *mixmap.exe")).is_ok());
        assert!(parse_checksum(&hash).is_ok());
        assert!(parse_checksum(&format!("{hash}  other.exe")).is_err());
        assert!(parse_checksum("xyz  mixmap.exe").is_err());
        assert!(parse_checksum("").is_err());
    }

    #[test]
    fn verifies_size_hash_and_kind() {
        let good = b"MZ fake exe";
        let sum = hex(&Sha256::digest(good));
        assert!(verify(good, good.len() as u64, &sum).is_ok());
        assert!(verify(b"MZ other!!!", good.len() as u64, &sum).is_err());
        assert!(verify(b"MZ short", good.len() as u64, &sum).is_err());
        let not_exe = b"PK zip file";
        assert!(
            verify(
                not_exe,
                not_exe.len() as u64,
                &hex(&Sha256::digest(not_exe))
            )
            .unwrap_err()
            .contains("not a Windows program")
        );
    }

    #[test]
    fn swaps_files_and_keeps_the_old_one_aside() {
        let dir = std::env::temp_dir().join(format!("mixmap-swap-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let exe = dir.join("mixmap.exe");
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
