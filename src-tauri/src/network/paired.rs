//! Paired peers and their secrets: `%APPDATA%\mixmap\paired.json`. Machine-local,
//! never part of exports or sync.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use super::crypto::{hex, unhex};
use crate::Error;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct Stored {
    id: String,
    /// Last address:port it was reached at (fallback when mDNS doesn't see it).
    last_address: Option<String>,
    #[serde(default)]
    last_sync_at: Option<u64>,
    name: String,
    paired_at: u64,
    secret: String,
}

/// A paired peer as the UI sees it (no secret).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairedPeer {
    pub id: String,
    pub last_address: Option<String>,
    /// When the last sync with it succeeded (ms since the epoch).
    pub last_sync_at: Option<u64>,
    pub name: String,
    pub paired_at: u64,
}

pub struct PairedStore {
    path: PathBuf,
    peers: Mutex<Vec<Stored>>,
}

impl PairedStore {
    /// Load from `path` (missing or unreadable file = no peers).
    pub fn load(path: PathBuf) -> Self {
        let peers = std::fs::read(&path)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        Self {
            path,
            peers: Mutex::new(peers),
        }
    }

    fn save(&self, peers: &[Stored]) -> Result<(), Error> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| Error::Invalid(e.to_string()))?;
        }
        let json = serde_json::to_vec_pretty(peers).map_err(|e| Error::Invalid(e.to_string()))?;
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, json)
            .and_then(|_| std::fs::rename(&tmp, &self.path))
            .map_err(|e| Error::Invalid(format!("cannot write {}: {e}", self.path.display())))
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<Stored>> {
        self.peers.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn list(&self) -> Vec<PairedPeer> {
        let mut list: Vec<PairedPeer> = self
            .lock()
            .iter()
            .map(|s| PairedPeer {
                id: s.id.clone(),
                last_address: s.last_address.clone(),
                last_sync_at: s.last_sync_at,
                name: s.name.clone(),
                paired_at: s.paired_at,
            })
            .collect();
        list.sort_by(|a, b| a.name.cmp(&b.name));
        list
    }

    pub fn secret(&self, id: &str) -> Option<[u8; 32]> {
        self.lock()
            .iter()
            .find(|s| s.id == id)
            .and_then(|s| unhex(&s.secret))
    }

    pub fn last_address(&self, id: &str) -> Option<String> {
        self.lock()
            .iter()
            .find(|s| s.id == id)
            .and_then(|s| s.last_address.clone())
    }

    /// Add or replace a peer (re-pairing replaces the secret).
    pub fn insert(
        &self,
        id: &str,
        name: &str,
        secret: &[u8; 32],
        address: Option<String>,
    ) -> Result<(), Error> {
        let mut peers = self.lock();
        peers.retain(|p| p.id != id);
        peers.push(Stored {
            id: id.into(),
            last_address: address,
            last_sync_at: None,
            name: name.into(),
            paired_at: now_ms(),
            secret: hex(secret),
        });
        self.save(&peers)
    }

    /// Remember a new name / address of a paired peer (no-op for unknown ids).
    pub fn touch(
        &self,
        id: &str,
        name: Option<&str>,
        address: Option<String>,
    ) -> Result<(), Error> {
        let mut peers = self.lock();
        let Some(p) = peers.iter_mut().find(|p| p.id == id) else {
            return Ok(());
        };
        let before = p.clone();
        if let Some(n) = name {
            p.name = n.into();
        }
        if address.is_some() {
            p.last_address = address;
        }
        if *p == before {
            return Ok(());
        }
        self.save(&peers)
    }

    /// Record a successful sync (and the address that worked, if known).
    pub fn synced(&self, id: &str, address: Option<String>) -> Result<(), Error> {
        let mut peers = self.lock();
        let Some(p) = peers.iter_mut().find(|p| p.id == id) else {
            return Ok(());
        };
        p.last_sync_at = Some(now_ms());
        if address.is_some() {
            p.last_address = address;
        }
        self.save(&peers)
    }

    pub fn remove(&self, id: &str) -> Result<bool, Error> {
        let mut peers = self.lock();
        let before = peers.len();
        peers.retain(|p| p.id != id);
        if peers.len() == before {
            return Ok(false);
        }
        self.save(&peers)?;
        Ok(true)
    }
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn persists_peers_without_exposing_secrets() {
        let dir = std::env::temp_dir().join(format!("mixmap-paired-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join("paired.json");
        let store = PairedStore::load(path.clone());
        assert!(store.list().is_empty());
        let secret = [7u8; 32];
        store
            .insert("b", "Laptop", &secret, Some("192.168.1.2:4000".into()))
            .unwrap();
        store.touch("b", Some("Club laptop"), None).unwrap();

        let again = PairedStore::load(path);
        assert_eq!(again.secret("b"), Some(secret));
        let list = again.list();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "Club laptop");
        assert_eq!(list[0].last_address.as_deref(), Some("192.168.1.2:4000"));
        assert!(!serde_json::to_string(&list).unwrap().contains("0707"));
        assert!(again.remove("b").unwrap());
        assert!(!again.remove("b").unwrap());
        assert!(again.list().is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
