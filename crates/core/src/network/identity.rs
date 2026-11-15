//! This MixMap instance's identity on the network: a random id (stable across
//! restarts) and a display name, stored in `%APPDATA%\mixmap\device.json`.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::Error;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Device {
    /// Random UUID, created on first start.
    pub id: String,
    /// Shown to other devices (defaults to the computer name).
    pub name: String,
}

fn default_name() -> String {
    std::env::var("COMPUTERNAME")
        .ok()
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| "MixMap".into())
}

/// Load the identity from `path`, creating (and saving) a new one if it is missing
/// or unreadable.
pub fn load_or_create(path: &Path) -> Result<Device, Error> {
    if let Some(d) = std::fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice::<Device>(&b).ok())
        .filter(|d| !d.id.is_empty())
    {
        return Ok(d);
    }
    let device = Device {
        id: uuid::Uuid::new_v4().to_string(),
        name: default_name(),
    };
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| Error::Invalid(format!("cannot create {}: {e}", dir.display())))?;
    }
    let json = serde_json::to_vec_pretty(&device).map_err(|e| Error::Invalid(e.to_string()))?;
    std::fs::write(path, json)
        .map_err(|e| Error::Invalid(format!("cannot write {}: {e}", path.display())))?;
    Ok(device)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn created_once_then_reused() {
        let dir = std::env::temp_dir().join(format!("mixmap-identity-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join("device.json");
        let a = load_or_create(&path).unwrap();
        assert_eq!(a.id.len(), 36);
        assert!(!a.name.is_empty());
        assert_eq!(load_or_create(&path).unwrap(), a);
        // A broken file is replaced by a new identity.
        std::fs::write(&path, "nope").unwrap();
        assert_ne!(load_or_create(&path).unwrap().id, a.id);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
