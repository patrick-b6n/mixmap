//! mDNS: advertise this instance as `_mixmap._tcp.local.` and discover others on
//! the LAN. TXT records carry the device id, display name and protocol version.

use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::Serialize;

use super::identity::Device;
use crate::Error;

pub const SERVICE_TYPE: &str = "_mixmap._tcp.local.";

/// Version of the sync protocol; peers with another version are listed but can't sync.
pub const PROTOCOL: u32 = 1;

/// Another mixmap instance on the network.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Peer {
    /// IPv4 addresses (IPv6 link-local addresses are left out: they need a scope).
    pub addresses: Vec<String>,
    pub id: String,
    pub name: String,
    pub port: u16,
    pub protocol: u32,
}

type Peers = Arc<Mutex<HashMap<String, Peer>>>;

/// Running advertisement + browser. Dropping it unregisters and stops the daemon.
pub struct Discovery {
    daemon: ServiceDaemon,
    fullname: String,
    peers: Peers,
    thread: Option<JoinHandle<()>>,
}

fn mdns_err(e: mdns_sd::Error) -> Error {
    Error::Invalid(format!("mDNS: {e}"))
}

impl Discovery {
    /// Advertise `me` (reachable on `port`) and start browsing. `on_change` gets the
    /// current peer list whenever it changes (called from a background thread).
    pub fn start(
        me: &Device,
        port: u16,
        on_change: impl Fn(Vec<Peer>) + Send + 'static,
    ) -> Result<Self, Error> {
        let daemon = ServiceDaemon::new().map_err(mdns_err)?;
        let instance = format!("mixmap-{}", me.id);
        let host = format!("{instance}.local.");
        let protocol = PROTOCOL.to_string();
        let props = [
            ("id", me.id.as_str()),
            ("name", me.name.as_str()),
            ("protocol", protocol.as_str()),
        ];
        let info = ServiceInfo::new(SERVICE_TYPE, &instance, &host, "", port, &props[..])
            .map_err(mdns_err)?
            .enable_addr_auto();
        let fullname = info.get_fullname().to_string();
        daemon.register(info).map_err(mdns_err)?;

        let events = daemon.browse(SERVICE_TYPE).map_err(mdns_err)?;
        let peers: Peers = Arc::default();
        let shared = peers.clone();
        let my_id = me.id.clone();
        let thread = std::thread::Builder::new()
            .name("mdns-browse".into())
            .spawn(move || {
                // Ends when the daemon shuts down and the channel closes.
                while let Ok(event) = events.recv() {
                    let changed = {
                        let mut map = shared.lock().unwrap_or_else(|e| e.into_inner());
                        apply(&mut map, event, &my_id)
                    };
                    if changed {
                        on_change(sorted(&shared));
                    }
                }
            })
            .map_err(|e| Error::Invalid(format!("mDNS thread: {e}")))?;
        Ok(Self {
            daemon,
            fullname,
            peers,
            thread: Some(thread),
        })
    }

    /// Peers seen so far, by name.
    pub fn peers(&self) -> Vec<Peer> {
        sorted(&self.peers)
    }
}

impl Drop for Discovery {
    fn drop(&mut self) {
        let _ = self.daemon.unregister(&self.fullname);
        let _ = self.daemon.shutdown();
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

fn sorted(peers: &Peers) -> Vec<Peer> {
    let mut list: Vec<Peer> = peers
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .values()
        .cloned()
        .collect();
    list.sort_by(|a, b| a.name.cmp(&b.name).then(a.id.cmp(&b.id)));
    list
}

/// Try order for a peer's addresses: home/office LANs first, loopback last.
fn rank(a: &Ipv4Addr) -> u8 {
    let [x, y, ..] = a.octets();
    match (x, y) {
        (192, 168) => 0,
        (10, _) => 1,
        (172, 16..=31) => 2,
        _ if a.is_link_local() => 4,
        _ if a.is_loopback() => 5,
        _ => 3,
    }
}

/// Update the peer map from one mDNS event; true if it changed. Our own
/// advertisement is ignored.
fn apply(map: &mut HashMap<String, Peer>, event: ServiceEvent, my_id: &str) -> bool {
    match event {
        ServiceEvent::ServiceResolved(s) => {
            let Some(id) = s.get_property_val_str("id").map(str::to_string) else {
                return false;
            };
            if id == my_id {
                return false;
            }
            let mut v4: Vec<Ipv4Addr> = s.get_addresses_v4().into_iter().collect();
            v4.sort_by_key(|a| (rank(a), *a));
            let addresses = v4.iter().map(Ipv4Addr::to_string).collect();
            let peer = Peer {
                addresses,
                name: s
                    .get_property_val_str("name")
                    .unwrap_or("mixmap")
                    .to_string(),
                id,
                port: s.get_port(),
                protocol: s
                    .get_property_val_str("protocol")
                    .and_then(|p| p.parse().ok())
                    .unwrap_or(0),
            };
            map.insert(s.fullname.clone(), peer.clone()) != Some(peer)
        }
        ServiceEvent::ServiceRemoved(_, fullname) => map.remove(&fullname).is_some(),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lan_addresses_come_first() {
        let mut v: Vec<Ipv4Addr> = [
            "127.0.0.1",
            "10.2.0.2",
            "8.8.8.8",
            "192.168.1.31",
            "172.18.0.1",
            "169.254.1.1",
        ]
        .iter()
        .map(|s| s.parse().unwrap())
        .collect();
        v.sort_by_key(|a| (rank(a), *a));
        let s: Vec<String> = v.iter().map(Ipv4Addr::to_string).collect();
        assert_eq!(
            s,
            [
                "192.168.1.31",
                "10.2.0.2",
                "172.18.0.1",
                "8.8.8.8",
                "169.254.1.1",
                "127.0.0.1"
            ]
        );
    }
    use std::sync::mpsc;
    use std::time::Duration;

    /// Two instances on this machine find each other (multicast loopback).
    #[test]
    fn two_instances_discover_each_other() {
        let a = Device {
            id: format!("test-a-{}", std::process::id()),
            name: "Alpha".into(),
        };
        let b = Device {
            id: format!("test-b-{}", std::process::id()),
            name: "Beta".into(),
        };
        let (tx, rx) = mpsc::channel();
        let da = Discovery::start(&a, 40001, move |peers| {
            let _ = tx.send(peers);
        })
        .unwrap();
        let db = Discovery::start(&b, 40002, |_| {}).unwrap();
        let found = loop {
            let peers = rx
                .recv_timeout(Duration::from_secs(10))
                .expect("Beta not discovered within 10 s");
            if let Some(p) = peers.into_iter().find(|p| p.id == b.id) {
                break p;
            }
        };
        assert_eq!(found.name, "Beta");
        assert_eq!(found.port, 40002);
        assert_eq!(found.protocol, PROTOCOL);
        assert!(!found.addresses.is_empty());
        // Never lists itself.
        assert!(da.peers().iter().all(|p| p.id != a.id));
        drop(db);
        drop(da);
    }
}
