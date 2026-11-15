//! Network sync state shared by the LAN listener (requests from other instances) and
//! the local API (requests from this instance's UI): pairing on both sides, the
//! paired-peer store and the discovered peers.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use x25519_dalek::{EphemeralSecret, PublicKey};

use super::crypto::{self, hex, unhex, Handshake};
use super::paired::{PairedPeer, PairedStore};
use super::{Device, Peer, PROTOCOL};
use crate::Error;

/// Sends an event to this instance's UI (`name`, JSON payload).
pub type Emit = Arc<dyn Fn(&'static str, serde_json::Value) + Send + Sync>;

/// Whether this instance's UI is connected (so it can answer sync requests).
pub type UiPresence = Arc<dyn Fn() -> bool + Send + Sync>;

/// How long a pairing code is valid.
const PAIRING_TTL: Duration = Duration::from_secs(120);
/// Wrong codes allowed before a pairing request is dropped.
const MAX_ATTEMPTS: u8 = 3;
/// Pending incoming requests kept at once (others are refused).
const MAX_PENDING: usize = 8;

#[derive(Debug, Deserialize, Serialize)]
pub struct PairStart {
    pub id: String,
    pub name: String,
    /// The initiator's LAN listener port (so the target can reach it later).
    pub port: u16,
    pub protocol: u32,
    pub public: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct PairStartReply {
    pub id: String,
    pub name: String,
    pub public: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct PairConfirm {
    pub id: String,
    pub proof: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct PairConfirmReply {
    pub proof: String,
}

struct Incoming {
    address: Option<String>,
    attempts: u8,
    code: String,
    expires: Instant,
    handshake: Handshake,
    name: String,
}

struct Outgoing {
    address: String,
    expires: Instant,
    handshake: Handshake,
    name: String,
}

pub struct SyncHub {
    pub device: Device,
    /// Our LAN listener port.
    pub port: u16,
    pub paired: PairedStore,
    emit: Emit,
    discovered: Mutex<Vec<Peer>>,
    incoming: Mutex<HashMap<String, Incoming>>,
    outgoing: Mutex<HashMap<String, Outgoing>>,
    /// Signatures seen recently (replay protection), with their request time.
    seen: Mutex<HashMap<[u8; 32], u64>>,
    /// Sync requests waiting for our UI's answer.
    ui_requests: Mutex<HashMap<String, std::sync::mpsc::Sender<super::exchange::UiReply>>>,
    ui_presence: Mutex<UiPresence>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl SyncHub {
    pub fn new(device: Device, port: u16, paired: PairedStore, emit: Emit) -> Self {
        Self {
            device,
            discovered: Mutex::default(),
            emit,
            incoming: Mutex::default(),
            outgoing: Mutex::default(),
            paired,
            port,
            seen: Mutex::default(),
            ui_presence: Mutex::new(Arc::new(|| true)),
            ui_requests: Mutex::default(),
        }
    }

    /// Tell the hub how to check that our UI is connected (default: always).
    pub fn set_ui_presence(&self, f: UiPresence) {
        *lock(&self.ui_presence) = f;
    }

    pub(super) fn ui_present(&self) -> bool {
        let f = lock(&self.ui_presence).clone();
        f()
    }

    pub(super) fn emit(&self, name: &'static str, payload: serde_json::Value) {
        (self.emit)(name, payload)
    }

    pub(super) fn ui_requests(
        &self,
    ) -> std::sync::MutexGuard<'_, HashMap<String, std::sync::mpsc::Sender<super::exchange::UiReply>>>
    {
        lock(&self.ui_requests)
    }

    /// Remember a request signature; false if it was seen before (a replay).
    /// Entries older than the allowed clock skew are dropped (their time no longer passes).
    pub(super) fn remember_signature(&self, sig: [u8; 32], time: u64) -> bool {
        let mut seen = lock(&self.seen);
        let horizon = super::paired::now_ms().saturating_sub(10 * 60 * 1000);
        seen.retain(|_, t| *t >= horizon);
        seen.insert(sig, time).is_none()
    }

    /// Discovery reports the current peers here.
    pub fn set_discovered(&self, peers: Vec<Peer>) {
        *lock(&self.discovered) = peers;
    }

    pub fn discovered(&self) -> Vec<Peer> {
        lock(&self.discovered).clone()
    }

    pub fn paired_peers(&self) -> Vec<PairedPeer> {
        self.paired.list()
    }

    /// `ip:port` candidates for a peer: discovered addresses first, then the last one
    /// that worked.
    pub fn addresses(&self, peer_id: &str) -> Vec<String> {
        let mut out: Vec<String> = lock(&self.discovered)
            .iter()
            .filter(|p| p.id == peer_id)
            .flat_map(|p| p.addresses.iter().map(move |a| format!("{a}:{}", p.port)))
            .collect();
        if let Some(last) = self.paired.last_address(peer_id) {
            if !out.contains(&last) {
                out.push(last);
            }
        }
        out
    }

    // ---- Target side (shows the code) ----------------------------------------

    /// Another instance wants to pair: answer with our key and show a code in our UI.
    pub fn handle_pair_start(
        &self,
        req: PairStart,
        remote_ip: Option<String>,
    ) -> Result<PairStartReply, Error> {
        if req.protocol != PROTOCOL {
            return Err(Error::Invalid(format!(
                "this mixmap speaks sync protocol {PROTOCOL}, yours {}: update both",
                req.protocol
            )));
        }
        if req.id == self.device.id {
            return Err(Error::Invalid("cannot pair with itself".into()));
        }
        let their: [u8; 32] =
            unhex(&req.public).ok_or_else(|| Error::Invalid("bad public key".into()))?;
        let secret = EphemeralSecret::random();
        let public = PublicKey::from(&secret);
        let handshake = Handshake {
            id_a: req.id.clone(),
            id_b: self.device.id.clone(),
            public_a: their,
            public_b: public.to_bytes(),
            shared: secret.diffie_hellman(&PublicKey::from(their)).to_bytes(),
        };
        let code = crypto::random_code();
        let expires = Instant::now() + PAIRING_TTL;
        {
            let mut pending = lock(&self.incoming);
            pending.retain(|_, p| p.expires > Instant::now());
            if pending.len() >= MAX_PENDING && !pending.contains_key(&req.id) {
                return Err(Error::Forbidden("too many pairing requests".into()));
            }
            pending.insert(
                req.id.clone(),
                Incoming {
                    address: remote_ip.map(|ip| format!("{ip}:{}", req.port)),
                    attempts: 0,
                    code: code.clone(),
                    expires,
                    handshake,
                    name: req.name.clone(),
                },
            );
        }
        (self.emit)(
            "pair-request",
            serde_json::json!({
                "code": code,
                "expiresInMs": PAIRING_TTL.as_millis() as u64,
                "id": req.id,
                "name": req.name,
            }),
        );
        Ok(PairStartReply {
            id: self.device.id.clone(),
            name: self.device.name.clone(),
            public: hex(&public.to_bytes()),
        })
    }

    /// The initiator proves it has the code; on success both sides store the pairing.
    pub fn handle_pair_confirm(&self, req: PairConfirm) -> Result<PairConfirmReply, Error> {
        let proof: [u8; 32] =
            unhex(&req.proof).ok_or_else(|| Error::Invalid("bad proof".into()))?;
        let mut pending = lock(&self.incoming);
        let Some(p) = pending.get_mut(&req.id) else {
            return Err(Error::NotFound(
                "no pairing request (expired?): start again".into(),
            ));
        };
        if p.expires <= Instant::now() {
            pending.remove(&req.id);
            return Err(Error::NotFound("the code expired: start again".into()));
        }
        let secret = p.handshake.secret(&p.code);
        if !crypto::same(&proof, &crypto::proof(&secret, "a")) {
            p.attempts += 1;
            if p.attempts >= MAX_ATTEMPTS {
                let p = pending.remove(&req.id).expect("present");
                drop(pending);
                self.emit_finished(&req.id, &p.name, false);
                return Err(Error::Forbidden(
                    "wrong code, too many attempts: start again".into(),
                ));
            }
            return Err(Error::Forbidden("wrong code".into()));
        }
        let p = pending.remove(&req.id).expect("present");
        drop(pending);
        self.paired.insert(&req.id, &p.name, &secret, p.address)?;
        self.emit_finished(&req.id, &p.name, true);
        Ok(PairConfirmReply {
            proof: hex(&crypto::proof(&secret, "b")),
        })
    }

    fn emit_finished(&self, id: &str, name: &str, ok: bool) {
        (self.emit)(
            "pair-finished",
            serde_json::json!({ "id": id, "name": name, "ok": ok }),
        );
    }

    // ---- Initiator side (types the code) ------------------------------------

    /// Ask a discovered peer to pair; it shows a code. Returns its name.
    pub fn pair_start(&self, peer_id: &str) -> Result<String, Error> {
        let secret = EphemeralSecret::random();
        let public = PublicKey::from(&secret);
        let req = PairStart {
            id: self.device.id.clone(),
            name: self.device.name.clone(),
            port: self.port,
            protocol: PROTOCOL,
            public: hex(&public.to_bytes()),
        };
        let body = serde_json::to_vec(&req).map_err(|e| Error::Invalid(e.to_string()))?;
        let (address, reply) = self.post_any(peer_id, "/sync/pair/start", &[], &body)?;
        let reply: PairStartReply = parse(&reply)?;
        if reply.id != peer_id {
            return Err(Error::Invalid(
                "a different device answered at that address".into(),
            ));
        }
        let their: [u8; 32] =
            unhex(&reply.public).ok_or_else(|| Error::Invalid("bad public key".into()))?;
        let handshake = Handshake {
            id_a: self.device.id.clone(),
            id_b: reply.id.clone(),
            public_a: public.to_bytes(),
            public_b: their,
            shared: secret.diffie_hellman(&PublicKey::from(their)).to_bytes(),
        };
        lock(&self.outgoing).insert(
            peer_id.into(),
            Outgoing {
                address,
                expires: Instant::now() + PAIRING_TTL,
                handshake,
                name: reply.name.clone(),
            },
        );
        Ok(reply.name)
    }

    /// Finish pairing with the code shown on the other device.
    pub fn pair_confirm(&self, peer_id: &str, code: &str) -> Result<PairedPeer, Error> {
        let code: String = code.chars().filter(|c| c.is_ascii_digit()).collect();
        if code.len() != 6 {
            return Err(Error::Invalid("the code has 6 digits".into()));
        }
        let (address, handshake, name) = {
            let out = lock(&self.outgoing);
            let o = out
                .get(peer_id)
                .filter(|o| o.expires > Instant::now())
                .ok_or_else(|| Error::NotFound("pairing expired: start again".into()))?;
            (o.address.clone(), o.handshake.clone(), o.name.clone())
        };
        let secret = handshake.secret(&code);
        let req = PairConfirm {
            id: self.device.id.clone(),
            proof: hex(&crypto::proof(&secret, "a")),
        };
        let body = serde_json::to_vec(&req).map_err(|e| Error::Invalid(e.to_string()))?;
        let reply = match http::post(&address, "/sync/pair/confirm", &[], &body)? {
            (200, _, b) => b,
            (403 | 404, _, b) => {
                let msg = String::from_utf8_lossy(&b).to_string();
                if !msg.contains("wrong code") || msg.contains("too many") {
                    lock(&self.outgoing).remove(peer_id);
                }
                return Err(Error::Forbidden(msg));
            }
            (s, _, b) => {
                return Err(Error::Invalid(format!(
                    "{s}: {}",
                    String::from_utf8_lossy(&b)
                )))
            }
        };
        let reply: PairConfirmReply = parse(&reply)?;
        let theirs: [u8; 32] =
            unhex(&reply.proof).ok_or_else(|| Error::Invalid("bad proof".into()))?;
        if !crypto::same(&theirs, &crypto::proof(&secret, "b")) {
            lock(&self.outgoing).remove(peer_id);
            return Err(Error::Forbidden(
                "the other device's answer didn't check out: not paired".into(),
            ));
        }
        lock(&self.outgoing).remove(peer_id);
        self.paired
            .insert(peer_id, &name, &secret, Some(address.clone()))?;
        Ok(self
            .paired
            .list()
            .into_iter()
            .find(|p| p.id == peer_id)
            .expect("just stored"))
    }

    /// Forget a paired peer on this side.
    pub fn unpair(&self, peer_id: &str) -> Result<bool, Error> {
        self.paired.remove(peer_id)
    }

    /// POST to the first address of `peer_id` that answers; returns that address and
    /// the body of a 200 response.
    fn post_any(
        &self,
        peer_id: &str,
        path: &str,
        headers: &[(&str, String)],
        body: &[u8],
    ) -> Result<(String, Vec<u8>), Error> {
        let candidates = self.addresses(peer_id);
        if candidates.is_empty() {
            return Err(Error::NotFound("that device isn't on the network".into()));
        }
        let mut last = None;
        for address in candidates {
            match http::post(&address, path, headers, body) {
                Ok((200, _, b)) => return Ok((address, b)),
                Ok((status, _, b)) => {
                    let msg = String::from_utf8_lossy(&b).to_string();
                    return Err(match status {
                        403 => Error::Forbidden(msg),
                        404 | 422 => Error::NotFound(msg),
                        _ => Error::Invalid(format!("{status}: {msg}")),
                    });
                }
                Err(e) => last = Some(e),
            }
        }
        Err(last.unwrap_or_else(|| Error::NotFound("unreachable".into())))
    }
}

fn parse<T: serde::de::DeserializeOwned>(body: &[u8]) -> Result<T, Error> {
    serde_json::from_slice(body).map_err(|e| Error::Invalid(format!("unexpected answer: {e}")))
}

/// Minimal blocking HTTP client for peer requests (plain HTTP on the LAN).
pub mod http {
    use std::time::Duration;

    use crate::Error;

    pub type Response = (u16, Vec<(String, String)>, Vec<u8>);

    pub fn post(
        address: &str,
        path: &str,
        headers: &[(&str, String)],
        body: &[u8],
    ) -> Result<Response, Error> {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .timeout_connect(Some(Duration::from_secs(3)))
            // The other side's UI may take a while to merge a large library.
            .timeout_global(Some(Duration::from_secs(120)))
            .build()
            .into();
        let mut req = agent
            .post(format!("http://{address}{path}"))
            .header("content-type", "application/json");
        for (k, v) in headers {
            req = req.header(*k, v);
        }
        let mut res = req
            .send(body)
            .map_err(|e| Error::NotFound(format!("cannot reach {address}: {e}")))?;
        let status = res.status().as_u16();
        let headers = res
            .headers()
            .iter()
            .filter_map(|(k, v)| Some((k.as_str().to_string(), v.to_str().ok()?.to_string())))
            .collect();
        let body = res
            .body_mut()
            .with_config()
            .limit(256 * 1024 * 1024)
            .read_to_vec()
            .map_err(|e| Error::Invalid(format!("reading the answer: {e}")))?;
        Ok((status, headers, body))
    }
}
