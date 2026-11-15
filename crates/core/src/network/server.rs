//! The LAN listener (all interfaces, OS-assigned port, advertised via mDNS). It only
//! serves `/sync/*`; the local API (raw SQL bridge etc.) stays on localhost.

use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
    body::Bytes,
    extract::{ConnectInfo, DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Serialize;
use tokio::net::TcpListener;

use super::exchange::{self, Signed};
use super::hub::{PairConfirm, PairStart, SyncHub};
use super::PROTOCOL;
use crate::Error;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hello {
    pub id: String,
    pub name: String,
    pub protocol: u32,
}

struct LanError(Error);

impl IntoResponse for LanError {
    fn into_response(self) -> Response {
        let status = match self.0 {
            Error::Invalid(_) => StatusCode::BAD_REQUEST,
            Error::NotFound(_) => StatusCode::NOT_FOUND,
            Error::Forbidden(_) => StatusCode::FORBIDDEN,
        };
        (status, self.0.to_string()).into_response()
    }
}

type Hub = State<Arc<SyncHub>>;

async fn hello(State(hub): Hub) -> Json<Hello> {
    Json(Hello {
        id: hub.device.id.clone(),
        name: hub.device.name.clone(),
        protocol: PROTOCOL,
    })
}

async fn pair_start(
    State(hub): Hub,
    ConnectInfo(remote): ConnectInfo<SocketAddr>,
    Json(req): Json<PairStart>,
) -> Result<Response, LanError> {
    let ip = remote.ip().to_string();
    tokio::task::spawn_blocking(move || hub.handle_pair_start(req, Some(ip)))
        .await
        .map_err(|e| LanError(Error::Invalid(e.to_string())))?
        .map(|r| Json(r).into_response())
        .map_err(LanError)
}

async fn pair_confirm(State(hub): Hub, Json(req): Json<PairConfirm>) -> Result<Response, LanError> {
    tokio::task::spawn_blocking(move || hub.handle_pair_confirm(req))
        .await
        .map_err(|e| LanError(Error::Invalid(e.to_string())))?
        .map(|r| Json(r).into_response())
        .map_err(LanError)
}

/// A paired peer's signed exchange request; our UI merges and answers.
async fn exchange(State(hub): Hub, headers: HeaderMap, body: Bytes) -> Result<Response, LanError> {
    let header = |k: &str| {
        headers
            .get(k)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string)
    };
    let signed = Signed {
        peer: header(exchange::HEADER_PEER).unwrap_or_default(),
        signature: header(exchange::HEADER_SIGNATURE).unwrap_or_default(),
        time: header(exchange::HEADER_TIME)
            .and_then(|t| t.parse().ok())
            .unwrap_or(0),
    };
    let (out, time, sig) = tokio::task::spawn_blocking(move || hub.handle_exchange(signed, &body))
        .await
        .map_err(|e| LanError(Error::Invalid(e.to_string())))?
        .map_err(LanError)?;
    Ok((
        [
            (exchange::HEADER_TIME, time.to_string()),
            (exchange::HEADER_SIGNATURE, sig),
            ("content-type", "application/json".to_string()),
        ],
        out,
    )
        .into_response())
}

/// Routes other instances may call.
pub fn router(hub: Arc<SyncHub>) -> Router {
    Router::new()
        .route("/sync/hello", get(hello))
        .route("/sync/pair/start", post(pair_start))
        .route("/sync/pair/confirm", post(pair_confirm))
        .layer(DefaultBodyLimit::max(64 * 1024))
        // A whole library's links and boards.
        .route(
            exchange::PATH,
            post(exchange).layer(DefaultBodyLimit::max(256 * 1024 * 1024)),
        )
        .with_state(hub)
}

/// Bind the LAN listener on all interfaces with an OS-assigned port.
pub async fn bind() -> Result<(TcpListener, u16), Error> {
    let listener = TcpListener::bind(("0.0.0.0", 0))
        .await
        .map_err(|e| Error::Invalid(format!("cannot open the sync port: {e}")))?;
    let port = listener
        .local_addr()
        .map_err(|e| Error::Invalid(e.to_string()))?
        .port();
    Ok((listener, port))
}

/// Serve the LAN routes (with the caller's address available to handlers).
pub async fn serve(listener: TcpListener, hub: Arc<SyncHub>) -> std::io::Result<()> {
    axum::serve(
        listener,
        router(hub).into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::network::hub::Emit;
    use crate::network::paired::PairedStore;
    use crate::network::{Device, Peer};
    use std::sync::Mutex;

    pub(crate) type Events = Arc<Mutex<Vec<(String, serde_json::Value)>>>;

    pub(crate) struct Instance {
        pub events: Events,
        pub hub: Arc<SyncHub>,
        pub port: u16,
    }

    pub(crate) async fn instance(name: &str, dir: &std::path::Path) -> Instance {
        let (listener, port) = bind().await.unwrap();
        let events: Events = Arc::default();
        let sink = events.clone();
        let emit: Emit = Arc::new(move |n, v| sink.lock().unwrap().push((n.to_string(), v)));
        let hub = Arc::new(SyncHub::new(
            Device {
                id: format!("{name}-id"),
                name: name.into(),
            },
            port,
            PairedStore::load(dir.join(format!("{name}.json"))),
            emit,
        ));
        tokio::spawn(serve(listener, hub.clone()));
        Instance { events, hub, port }
    }

    pub(crate) fn see(a: &Instance, b: &Instance) {
        a.hub.set_discovered(vec![Peer {
            addresses: vec!["127.0.0.1".into()],
            id: b.hub.device.id.clone(),
            name: b.hub.device.name.clone(),
            port: b.port,
            protocol: PROTOCOL,
        }]);
    }

    pub(crate) fn code_shown(b: &Instance) -> String {
        let events = b.events.lock().unwrap();
        let (_, v) = events
            .iter()
            .rev()
            .find(|(n, _)| n == "pair-request")
            .expect("pair-request emitted");
        v["code"].as_str().unwrap().to_string()
    }

    /// Pair `a` with `b` (as the user would: start on a, type b's code on a).
    pub(crate) async fn pair(a: &Instance, b: &Instance) {
        see(a, b);
        let (hub, id) = (a.hub.clone(), b.hub.device.id.clone());
        tokio::task::spawn_blocking(move || hub.pair_start(&id))
            .await
            .unwrap()
            .unwrap();
        let code = code_shown(b);
        let (hub, id) = (a.hub.clone(), b.hub.device.id.clone());
        tokio::task::spawn_blocking(move || hub.pair_confirm(&id, &code))
            .await
            .unwrap()
            .unwrap();
    }

    fn temp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("mixmap-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn pairing_with_the_right_code_stores_both_sides() {
        let dir = temp("pair-ok");
        let (a, b) = (instance("alpha", &dir).await, instance("beta", &dir).await);
        see(&a, &b);
        let hub = a.hub.clone();
        let name = tokio::task::spawn_blocking(move || hub.pair_start("beta-id"))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(name, "beta");
        let code = code_shown(&b);
        let wrong = if code == "000000" { "000001" } else { "000000" };
        let hub = a.hub.clone();
        let err = tokio::task::spawn_blocking(move || hub.pair_confirm("beta-id", wrong))
            .await
            .unwrap()
            .unwrap_err();
        assert!(err.to_string().contains("wrong code"), "{err}");
        let hub = a.hub.clone();
        let peer = tokio::task::spawn_blocking(move || hub.pair_confirm("beta-id", &code))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(peer.name, "beta");
        assert_eq!(
            a.hub.paired.secret("beta-id").unwrap(),
            b.hub.paired.secret("alpha-id").unwrap()
        );
        let expected = format!("127.0.0.1:{}", a.port);
        assert_eq!(
            b.hub.paired.list()[0].last_address.as_deref(),
            Some(expected.as_str())
        );
        assert!(b
            .events
            .lock()
            .unwrap()
            .iter()
            .any(|(n, v)| n == "pair-finished" && v["ok"] == true));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn three_wrong_codes_end_the_request() {
        let dir = temp("pair-bad");
        let (a, b) = (instance("alpha", &dir).await, instance("beta", &dir).await);
        see(&a, &b);
        let hub = a.hub.clone();
        tokio::task::spawn_blocking(move || hub.pair_start("beta-id"))
            .await
            .unwrap()
            .unwrap();
        let code = code_shown(&b);
        let wrong = if code == "111111" { "222222" } else { "111111" };
        for _ in 0..3 {
            let hub = a.hub.clone();
            let _ = tokio::task::spawn_blocking(move || hub.pair_confirm("beta-id", wrong)).await;
        }
        // Even the right code no longer works.
        let hub = a.hub.clone();
        let err = tokio::task::spawn_blocking(move || hub.pair_confirm("beta-id", &code))
            .await
            .unwrap()
            .unwrap_err();
        assert!(err.to_string().contains("start again"), "{err}");
        assert!(a.hub.paired.list().is_empty() && b.hub.paired.list().is_empty());
        assert!(b
            .events
            .lock()
            .unwrap()
            .iter()
            .any(|(n, v)| n == "pair-finished" && v["ok"] == false));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
