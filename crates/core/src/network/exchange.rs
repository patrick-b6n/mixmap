//! "Sync now": two-way exchange between paired instances.
//!
//! The initiator's UI exports its data and calls `exchange`; the request is signed
//! and sent to the peer's `/sync/exchange`. The peer verifies it and hands the data to
//! its own UI (event `sync-request`), which merges it and answers via `ui_reply` with
//! its own export from before the merge. That answer goes back signed; the
//! initiator's UI merges it. Merging (last-write-wins, tombstones) is TypeScript.

use std::sync::mpsc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::crypto::{self, hex, unhex};
use super::hub::{http, SyncHub};
use super::paired::now_ms;
use crate::Error;

pub const PATH: &str = "/sync/exchange";
pub const HEADER_PEER: &str = "x-mixmap-peer";
pub const HEADER_TIME: &str = "x-mixmap-time";
pub const HEADER_SIGNATURE: &str = "x-mixmap-signature";

/// Allowed clock difference between two machines.
const MAX_SKEW_MS: u64 = 5 * 60 * 1000;
/// How long the peer's UI may take to merge and answer.
const UI_TIMEOUT: Duration = Duration::from_secs(90);

/// The peer UI's answer to a `sync-request`.
#[derive(Debug, Default, Deserialize, Serialize)]
pub struct UiReply {
    /// Its export from before merging ours.
    pub data: Option<Value>,
    /// Set when it couldn't merge (nothing changed there).
    pub error: Option<String>,
    /// What merging our data changed there (for the result summary).
    pub summary: Option<Value>,
}

/// A signed message's headers.
pub struct Signed {
    pub peer: String,
    pub signature: String,
    pub time: u64,
}

/// Signature over a response: same scheme, method "RESPONSE".
fn response_signature(secret: &[u8; 32], time: u64, body: &[u8]) -> [u8; 32] {
    crypto::signature(secret, "RESPONSE", PATH, time, body)
}

fn fresh(time: u64) -> bool {
    now_ms().abs_diff(time) <= MAX_SKEW_MS
}

impl SyncHub {
    /// Initiator: send our export to `peer_id` and return its answer
    /// (`{ data, summary }`).
    pub fn exchange(&self, peer_id: &str, data: Value) -> Result<Value, Error> {
        let secret = self
            .paired
            .secret(peer_id)
            .ok_or_else(|| Error::Forbidden("not paired with that device: pair it first".into()))?;
        let body = serde_json::to_vec(&serde_json::json!({ "data": data }))
            .map_err(|e| Error::Invalid(e.to_string()))?;
        let time = now_ms();
        let headers = [
            (HEADER_PEER, self.device.id.clone()),
            (HEADER_TIME, time.to_string()),
            (
                HEADER_SIGNATURE,
                hex(&crypto::signature(&secret, "POST", PATH, time, &body)),
            ),
        ];
        let candidates = self.addresses(peer_id);
        if candidates.is_empty() {
            return Err(Error::NotFound("that device isn't on the network".into()));
        }
        let mut last = None;
        for address in candidates {
            let (status, res_headers, res_body) = match http::post(&address, PATH, &headers, &body)
            {
                Ok(r) => r,
                Err(e) => {
                    last = Some(e);
                    continue;
                }
            };
            let text = || String::from_utf8_lossy(&res_body).to_string();
            match status {
                200 => {}
                403 => return Err(Error::Forbidden(text())),
                404 => return Err(Error::NotFound(text())),
                s => return Err(Error::Invalid(format!("{s}: {}", text()))),
            }
            let header = |k: &str| {
                res_headers
                    .iter()
                    .find(|(n, _)| n.eq_ignore_ascii_case(k))
                    .map(|(_, v)| v.as_str())
            };
            let time: u64 = header(HEADER_TIME)
                .and_then(|t| t.parse().ok())
                .ok_or_else(|| Error::Forbidden("unsigned answer".into()))?;
            let sig: [u8; 32] = header(HEADER_SIGNATURE)
                .and_then(unhex)
                .ok_or_else(|| Error::Forbidden("unsigned answer".into()))?;
            if !fresh(time) || !crypto::same(&sig, &response_signature(&secret, time, &res_body)) {
                return Err(Error::Forbidden(
                    "the answer's signature didn't check out".into(),
                ));
            }
            let value: Value = serde_json::from_slice(&res_body)
                .map_err(|e| Error::Invalid(format!("unexpected answer: {e}")))?;
            self.paired.synced(peer_id, Some(address))?;
            return Ok(value);
        }
        Err(last.unwrap_or_else(|| Error::NotFound("unreachable".into())))
    }

    /// Check a signed request from a paired peer (known peer, fresh, correct, not replayed).
    pub fn verify(
        &self,
        signed: &Signed,
        method: &str,
        path: &str,
        body: &[u8],
    ) -> Result<[u8; 32], Error> {
        let secret = self.paired.secret(&signed.peer).ok_or_else(|| {
            Error::Forbidden(format!(
                "{} is not paired with that device: pair again",
                self.device.name
            ))
        })?;
        let sig: [u8; 32] =
            unhex(&signed.signature).ok_or_else(|| Error::Forbidden("bad signature".into()))?;
        if !fresh(signed.time) {
            return Err(Error::Forbidden(
                "the clocks of the two computers differ by more than 5 minutes".into(),
            ));
        }
        if !crypto::same(
            &sig,
            &crypto::signature(&secret, method, path, signed.time, body),
        ) {
            return Err(Error::Forbidden("bad signature".into()));
        }
        if !self.remember_signature(sig, signed.time) {
            return Err(Error::Forbidden("request replayed".into()));
        }
        Ok(secret)
    }

    /// Target: a signed exchange request. Hands the data to our UI and waits for its
    /// answer; returns the response body with its time and signature.
    pub fn handle_exchange(
        &self,
        signed: Signed,
        body: &[u8],
    ) -> Result<(Vec<u8>, u64, String), Error> {
        let secret = self.verify(&signed, "POST", PATH, body)?;
        let request: Value = serde_json::from_slice(body)
            .map_err(|e| Error::Invalid(format!("bad request: {e}")))?;
        let data = request
            .get("data")
            .cloned()
            .ok_or_else(|| Error::Invalid("bad request: no data".into()))?;
        if !self.ui_present() {
            return Err(Error::NotFound(format!(
                "MixMap isn't open on {}: open it and sync again",
                self.device.name
            )));
        }
        let peer_name = self
            .paired
            .list()
            .into_iter()
            .find(|p| p.id == signed.peer)
            .map(|p| p.name)
            .unwrap_or_default();
        let request_id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = mpsc::channel();
        self.ui_requests().insert(request_id.clone(), tx);
        self.emit(
            "sync-request",
            serde_json::json!({
                "data": data,
                "peerId": signed.peer,
                "peerName": peer_name,
                "requestId": request_id,
            }),
        );
        let reply = rx.recv_timeout(UI_TIMEOUT);
        self.ui_requests().remove(&request_id);
        let reply = reply.map_err(|_| {
            Error::NotFound(format!(
                "MixMap on {} didn't answer in time",
                self.device.name
            ))
        })?;
        if let Some(e) = reply.error {
            return Err(Error::Invalid(format!(
                "{} couldn't merge: {e}",
                self.device.name
            )));
        }
        let out = serde_json::to_vec(&serde_json::json!({
            "data": reply.data,
            "summary": reply.summary,
        }))
        .map_err(|e| Error::Invalid(e.to_string()))?;
        self.paired.synced(&signed.peer, None)?;
        let time = now_ms();
        let sig = hex(&response_signature(&secret, time, &out));
        Ok((out, time, sig))
    }

    /// Our UI answered a `sync-request`.
    pub fn ui_reply(&self, request_id: &str, reply: UiReply) -> Result<(), Error> {
        let tx = self
            .ui_requests()
            .remove(request_id)
            .ok_or_else(|| Error::NotFound("that sync request is no longer waiting".into()))?;
        tx.send(reply)
            .map_err(|_| Error::NotFound("that sync request is no longer waiting".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::network::server::tests::{instance, pair};
    use std::sync::Arc;

    fn temp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("mixmap-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    /// Answer every `sync-request` on `b` like its UI would.
    fn auto_answer(b: &crate::network::server::tests::Instance, answer: Value) {
        let (events, hub) = (b.events.clone(), b.hub.clone());
        std::thread::spawn(move || {
            for _ in 0..200 {
                let req = events
                    .lock()
                    .unwrap()
                    .iter()
                    .find(|(n, _)| n == "sync-request")
                    .map(|(_, v)| v.clone());
                if let Some(req) = req {
                    assert_eq!(req["data"], serde_json::json!({"links": ["from a"]}));
                    hub.ui_reply(
                        req["requestId"].as_str().unwrap(),
                        UiReply {
                            data: Some(answer),
                            error: None,
                            summary: Some(serde_json::json!({"links": 1})),
                        },
                    )
                    .unwrap();
                    return;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
        });
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn exchange_round_trip_between_paired_instances() {
        let dir = temp("exchange-ok");
        let (a, b) = (instance("alpha", &dir).await, instance("beta", &dir).await);
        pair(&a, &b).await;
        auto_answer(&b, serde_json::json!({"links": ["from b"]}));
        let hub = a.hub.clone();
        let res = tokio::task::spawn_blocking(move || {
            hub.exchange("beta-id", serde_json::json!({"links": ["from a"]}))
        })
        .await
        .unwrap()
        .unwrap();
        assert_eq!(res["data"], serde_json::json!({"links": ["from b"]}));
        assert_eq!(res["summary"], serde_json::json!({"links": 1}));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn refuses_unpaired_forged_and_replayed_requests() {
        let dir = temp("exchange-bad");
        let (a, b) = (instance("alpha", &dir).await, instance("beta", &dir).await);
        pair(&a, &b).await;
        let secret = a.hub.paired.secret("beta-id").unwrap();
        let body = br#"{"data":{}}"#;
        let ok = |time: u64| Signed {
            peer: "alpha-id".into(),
            signature: hex(&crypto::signature(&secret, "POST", PATH, time, body)),
            time,
        };
        let hub = b.hub.clone();
        // Unknown peer.
        let stranger = Signed {
            peer: "mallory".into(),
            ..ok(now_ms())
        };
        assert!(hub.verify(&stranger, "POST", PATH, body).is_err());
        // Wrong key.
        let forged = Signed {
            signature: hex(&crypto::signature(&[9; 32], "POST", PATH, now_ms(), body)),
            ..ok(now_ms())
        };
        assert!(hub.verify(&forged, "POST", PATH, body).is_err());
        // Tampered body.
        assert!(hub
            .verify(&ok(now_ms()), "POST", PATH, br#"{"data":1}"#)
            .is_err());
        // Too old.
        assert!(hub
            .verify(&ok(now_ms() - 10 * 60 * 1000), "POST", PATH, body)
            .is_err());
        // Valid once, then a replay.
        let t = now_ms();
        assert!(hub.verify(&ok(t), "POST", PATH, body).is_ok());
        let err = hub.verify(&ok(t), "POST", PATH, body).unwrap_err();
        assert!(err.to_string().contains("replayed"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn tells_when_the_other_ui_is_closed() {
        let dir = temp("exchange-noui");
        let (a, b) = (instance("alpha", &dir).await, instance("beta", &dir).await);
        pair(&a, &b).await;
        b.hub.set_ui_presence(Arc::new(|| false));
        let hub = a.hub.clone();
        let err =
            tokio::task::spawn_blocking(move || hub.exchange("beta-id", serde_json::json!({})))
                .await
                .unwrap()
                .unwrap_err();
        assert!(err.to_string().contains("isn't open on beta"), "{err}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
