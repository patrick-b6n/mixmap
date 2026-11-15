//! Local HTTP server exposing the same API as the (future) Tauri commands.
//! Every command is `POST /api/<command>` with a JSON body. Backend events are
//! streamed as server-sent events on `GET /api/events` (Tauri: `emit`).
//! No CORS: the UI reaches it through the Vite proxy (same origin), so other websites
//! cannot read it.

use std::convert::Infallible;
use std::sync::{Arc, Mutex};

use axum::{
    extract::{DefaultBodyLimit, Path, Query, Request, State},
    http::{header, StatusCode},
    middleware::{self, Next},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::{get, post},
    Json, Router,
};
use mixmap_core::artwork::{ArtworkCache, Size};
use mixmap_core::network::exchange::UiReply;
use mixmap_core::network::paired::{PairedPeer, PairedStore};
use mixmap_core::network::{Device, Discovery, Peer, SyncHub};
use mixmap_core::rekordbox::library::Track;
use mixmap_core::rekordbox::playlists::Playlist;
use mixmap_core::service::{LibraryService, Source, Status};
use mixmap_core::store::{ExecResult, Statement, Store};
use mixmap_core::Error;
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;
use tokio_stream::{wrappers::BroadcastStream, Stream, StreamExt};

/// Local API address; `MIXMAP_DEV_ADDR` overrides it (second instance for sync tests).
const ADDR: &str = "127.0.0.1:5174";

/// A backend event: `name` is the event type, `data` its JSON payload.
#[derive(Clone, Debug)]
struct BackendEvent {
    data: String,
    name: &'static str,
}

#[derive(Clone)]
struct AppState {
    artwork: Arc<ArtworkCache>,
    events: broadcast::Sender<BackendEvent>,
    library: Arc<LibraryService>,
    /// Network sync: this device and the running mDNS discovery (None in tests).
    network: Arc<Mutex<Option<Network>>>,
    store: Arc<Store>,
    /// Keeps the master.db watcher alive.
    watcher: Arc<Mutex<Option<Box<dyn Send>>>>,
}

struct Network {
    /// Kept alive for the advertisement; dropped (unregistered) on shutdown.
    _discovery: Option<Discovery>,
    error: Option<String>,
    hub: Arc<SyncHub>,
}

impl AppState {
    fn new(source: Source, store: Store) -> Self {
        let (events, _) = broadcast::channel(64);
        let state = Self {
            artwork: Arc::new(ArtworkCache::new(mixmap_core::paths::artwork_dir())),
            events,
            library: LibraryService::new(source),
            network: Arc::new(Mutex::new(None)),
            store: Arc::new(store),
            watcher: Arc::new(Mutex::new(None)),
        };
        state.rewatch();
        state
    }

    fn emit(&self, name: &'static str, payload: &impl serde::Serialize) {
        emit(&self.events, name, payload);
    }

    /// (Re)start watching the current master.db; reloads are announced as `library`.
    fn rewatch(&self) {
        let events = self.events.clone();
        let watcher = self
            .library
            .watch(move |snap| emit(&events, "library", &snap.status()));
        let new: Option<Box<dyn Send>> = match watcher {
            Ok(w) => Some(Box::new(w)),
            Err(e) => {
                eprintln!("not watching the library source: {e}");
                None
            }
        };
        let old = std::mem::replace(
            &mut *self.watcher.lock().unwrap_or_else(|e| e.into_inner()),
            new,
        );
        // Dropping a watcher joins its thread: do it outside the lock.
        drop(old);
    }
}

fn emit(
    events: &broadcast::Sender<BackendEvent>,
    name: &'static str,
    payload: &impl serde::Serialize,
) {
    let data = serde_json::to_string(payload).unwrap_or_default();
    // No receivers is fine.
    let _ = events.send(BackendEvent { data, name });
}

struct ApiError(Error);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match self.0 {
            Error::Invalid(_) => StatusCode::BAD_REQUEST,
            // Not 404: that would look like a missing route.
            Error::NotFound(_) => StatusCode::UNPROCESSABLE_ENTITY,
            Error::Forbidden(_) => StatusCode::FORBIDDEN,
        };
        (status, self.0.to_string()).into_response()
    }
}

impl From<Error> for ApiError {
    fn from(e: Error) -> Self {
        Self(e)
    }
}

type ApiResult<T> = Result<Json<T>, ApiError>;

async fn library_location() -> ApiResult<mixmap_core::rekordbox::location::Location> {
    Ok(Json(mixmap_core::rekordbox::location::locate(None)?))
}

async fn library_status(State(s): State<AppState>) -> Json<Status> {
    Json(s.library.current().status())
}

/// Manual refresh: reload now and tell every client.
async fn refresh(State(s): State<AppState>) -> Result<Json<Status>, StatusCode> {
    let lib = s.library.clone();
    let snap = tokio::task::spawn_blocking(move || lib.reload())
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let status = snap.status();
    s.emit("library", &status);
    // The location may have changed (e.g. options.json now present).
    s.rewatch();
    Ok(Json(status))
}

async fn events(State(s): State<AppState>) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let library = s.library.clone();
    let stream = BroadcastStream::new(s.events.subscribe()).map(move |e| {
        let e = e.unwrap_or_else(|_lagged| BackendEvent {
            // This client missed events: resync it with the current library status.
            data: serde_json::to_string(&library.current().status()).unwrap_or_default(),
            name: "library",
        });
        Ok(Event::default().event(e.name).data(e.data))
    });
    Sse::new(stream).keep_alive(KeepAlive::default())
}

/// The whole library as one consistent snapshot: tracks, playlist and history trees
/// (each node with its ordered track ids = contents) and the version they belong to.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LibraryData<'a> {
    histories: &'a [Playlist],
    playlists: &'a [Playlist],
    tracks: &'a [Track],
    version: u64,
}

async fn library(State(s): State<AppState>) -> Result<Response, StatusCode> {
    let snap = s.library.current();
    // Serializing a large library is CPU work: keep it off the async workers.
    let body = tokio::task::spawn_blocking(move || {
        let lib = &snap.library;
        serde_json::to_vec(&LibraryData {
            histories: &lib.histories,
            playlists: &lib.playlists,
            tracks: &lib.tracks,
            version: snap.version,
        })
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(([(header::CONTENT_TYPE, "application/json")], body).into_response())
}

#[derive(Deserialize)]
struct ArtworkQuery {
    size: Option<Size>,
}

/// `GET /api/artwork/{track_id}?size=small|large`: JPEG thumbnail, 204 when the track
/// has no artwork (the UI then shows a placeholder).
async fn artwork(
    State(s): State<AppState>,
    Path(track_id): Path<String>,
    Query(q): Query<ArtworkQuery>,
) -> Response {
    let snap = s.library.current();
    let cache = s.artwork.clone();
    let size = q.size.unwrap_or(Size::Small);
    let result = tokio::task::spawn_blocking(move || {
        let track = snap.library.tracks.iter().find(|t| t.id == track_id)?;
        let root = snap
            .location
            .as_ref()
            .and_then(|l| l.analysis_root.as_deref());
        let path = cache.thumbnail(track, root, size)?;
        Some(std::fs::read(path))
    })
    .await;
    match result {
        Ok(Some(Ok(bytes))) => (
            [
                (header::CONTENT_TYPE, "image/jpeg"),
                // URLs carry the library version, so the content never changes.
                (
                    header::CACHE_CONTROL,
                    "private, max-age=31536000, immutable",
                ),
            ],
            bytes,
        )
            .into_response(),
        // "No artwork" is a normal answer, not an error: 204 keeps the console clean.
        Ok(None) => (
            StatusCode::NO_CONTENT,
            [(header::CACHE_CONTROL, "private, max-age=60")],
        )
            .into_response(),
        Ok(Some(Err(e))) => {
            eprintln!("artwork: {e}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
        Err(e) => {
            eprintln!("artwork task failed: {e}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

#[derive(Deserialize)]
struct SetSource {
    source: Source,
}

/// Switch the library source (master.db auto/override or XML export) and reload.
async fn set_library_source(
    State(s): State<AppState>,
    Json(req): Json<SetSource>,
) -> Result<Json<Status>, StatusCode> {
    let lib = s.library.clone();
    let snap = tokio::task::spawn_blocking(move || lib.set_source(req.source))
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let status = snap.status();
    s.emit("library", &status);
    s.rewatch();
    Ok(Json(status))
}

/// Generic bridge to mixmap.db: the schema and all queries live in TypeScript.
async fn db_query(
    State(s): State<AppState>,
    Json(stmt): Json<Statement>,
) -> ApiResult<Vec<serde_json::Map<String, serde_json::Value>>> {
    let store = s.store.clone();
    let rows = tokio::task::spawn_blocking(move || store.query(&stmt))
        .await
        .map_err(|e| ApiError(Error::Invalid(format!("query task: {e}"))))??;
    Ok(Json(rows))
}

#[derive(Deserialize)]
struct Execute {
    statements: Vec<Statement>,
}

/// Run statements in one transaction (all or nothing).
async fn db_execute(
    State(s): State<AppState>,
    Json(req): Json<Execute>,
) -> ApiResult<Vec<ExecResult>> {
    let store = s.store.clone();
    let results = tokio::task::spawn_blocking(move || store.execute(&req.statements))
        .await
        .map_err(|e| ApiError(Error::Invalid(format!("execute task: {e}"))))??;
    Ok(Json(results))
}

#[derive(Deserialize)]
struct WriteBackup {
    content: String,
    name: String,
}

#[derive(Serialize)]
struct Written {
    path: String,
}

/// Write an automatic backup into `%APPDATA%\mixmap\backups`.
async fn write_backup(Json(req): Json<WriteBackup>) -> ApiResult<Written> {
    let dir = mixmap_core::paths::backups_dir();
    let path = tokio::task::spawn_blocking(move || {
        mixmap_core::backups::write_backup(&dir, &req.name, &req.content)
    })
    .await
    .map_err(|e| ApiError(Error::Invalid(format!("backup task: {e}"))))??;
    Ok(Json(Written {
        path: path.display().to_string(),
    }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncStatus {
    device: Option<Device>,
    /// Why discovery isn't running (e.g. no network), if it isn't.
    error: Option<String>,
    paired: Vec<PairedPeer>,
    peers: Vec<Peer>,
    port: u16,
}

fn hub(s: &AppState) -> Result<Arc<SyncHub>, ApiError> {
    s.network
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .map(|n| n.hub.clone())
        .ok_or_else(|| ApiError(Error::NotFound("network sync is not running".into())))
}

/// This device, the MixMap instances discovered on the LAN and the paired ones.
async fn sync_status(State(s): State<AppState>) -> Json<SyncStatus> {
    let net = s.network.lock().unwrap_or_else(|e| e.into_inner());
    Json(match net.as_ref() {
        Some(n) => SyncStatus {
            device: Some(n.hub.device.clone()),
            error: n.error.clone(),
            paired: n.hub.paired_peers(),
            peers: n.hub.discovered(),
            port: n.hub.port,
        },
        None => SyncStatus {
            device: None,
            error: Some("network sync is not running".into()),
            paired: vec![],
            peers: vec![],
            port: 0,
        },
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PeerArg {
    peer_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairConfirmArg {
    code: String,
    peer_id: String,
}

#[derive(Serialize)]
struct Named {
    name: String,
}

/// Run blocking network work off the async runtime.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, Error> + Send + 'static,
) -> Result<T, ApiError> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| ApiError(Error::Invalid(format!("task: {e}"))))?
        .map_err(ApiError)
}

/// Ask a discovered device to pair; it shows a 6-digit code.
async fn pair_start(State(s): State<AppState>, Json(a): Json<PeerArg>) -> ApiResult<Named> {
    let hub = hub(&s)?;
    let name = blocking(move || hub.pair_start(&a.peer_id)).await?;
    Ok(Json(Named { name }))
}

/// Finish pairing with the code shown on the other device.
async fn pair_confirm(
    State(s): State<AppState>,
    Json(a): Json<PairConfirmArg>,
) -> ApiResult<PairedPeer> {
    let hub = hub(&s)?;
    Ok(Json(
        blocking(move || hub.pair_confirm(&a.peer_id, &a.code)).await?,
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExchangeArg {
    data: serde_json::Value,
    peer_id: String,
}

/// "Sync now": send our export to a paired device, get its export back.
async fn sync_exchange(
    State(s): State<AppState>,
    Json(a): Json<ExchangeArg>,
) -> ApiResult<serde_json::Value> {
    let hub = hub(&s)?;
    Ok(Json(
        blocking(move || hub.exchange(&a.peer_id, a.data)).await?,
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReplyArg {
    reply: UiReply,
    request_id: String,
}

/// Our UI's answer to a `sync-request` from a paired device.
async fn sync_reply(State(s): State<AppState>, Json(a): Json<ReplyArg>) -> ApiResult<bool> {
    let hub = hub(&s)?;
    blocking(move || hub.ui_reply(&a.request_id, a.reply)).await?;
    Ok(Json(true))
}

/// Forget a paired device (on this side).
async fn unpair(State(s): State<AppState>, Json(a): Json<PeerArg>) -> ApiResult<bool> {
    let hub = hub(&s)?;
    Ok(Json(blocking(move || hub.unpair(&a.peer_id)).await?))
}

/// Start the LAN listener and mDNS discovery. Peer changes are emitted as `peers`,
/// pairing requests from other devices as `pair-request` / `pair-finished`.
async fn start_network(state: &AppState) -> Result<(), Error> {
    let device =
        mixmap_core::network::identity::load_or_create(&mixmap_core::paths::device_path())?;
    let (listener, port) = mixmap_core::network::server::bind().await?;
    let events = state.events.clone();
    let hub = Arc::new(SyncHub::new(
        device.clone(),
        port,
        PairedStore::load(mixmap_core::paths::paired_path()),
        Arc::new(move |name, payload| emit(&events, name, &payload)),
    ));
    // A sync request can only be answered while a UI listens for events.
    let listeners = state.events.clone();
    hub.set_ui_presence(Arc::new(move || listeners.receiver_count() > 0));
    let lan = hub.clone();
    tokio::spawn(async move {
        if let Err(e) = mixmap_core::network::server::serve(listener, lan).await {
            eprintln!("sync listener stopped: {e}");
        }
    });
    let events = state.events.clone();
    let seen = hub.clone();
    let (discovery, error) = match Discovery::start(&device, port, move |peers| {
        seen.set_discovered(peers.clone());
        emit(&events, "peers", &peers)
    }) {
        Ok(d) => (Some(d), None),
        Err(e) => (None, Some(e.to_string())),
    };
    println!(
        "sync: {} ({}) on port {port}{}",
        device.name,
        device.id,
        error
            .as_ref()
            .map(|e| format!(", discovery off: {e}"))
            .unwrap_or_default()
    );
    *state.network.lock().unwrap_or_else(|e| e.into_inner()) = Some(Network {
        _discovery: discovery,
        error,
        hub,
    });
    Ok(())
}

/// Only answer requests addressed to this machine by name: blocks DNS-rebinding
/// pages from reaching the API (e.g. the raw SQL bridge) through a foreign host name.
async fn local_hosts_only(req: Request, next: Next) -> Response {
    let host = req
        .headers()
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");
    if is_local_host(host) {
        next.run(req).await
    } else {
        (StatusCode::FORBIDDEN, "forbidden host").into_response()
    }
}

fn is_local_host(host: &str) -> bool {
    let name = match host.strip_prefix('[') {
        Some(v6) => v6.split(']').next().unwrap_or(""),
        None => host.split(':').next().unwrap_or(""),
    };
    matches!(name, "localhost" | "127.0.0.1" | "::1")
}

fn app(state: AppState) -> Router {
    Router::new()
        .route("/api/artwork/{track_id}", get(artwork))
        .route("/api/db_execute", post(db_execute))
        .route("/api/db_query", post(db_query))
        .route("/api/events", get(events))
        .route("/api/hello", post(|| async { Json(mixmap_core::hello()) }))
        .route("/api/library", post(library))
        .route("/api/library_location", post(library_location))
        .route("/api/library_status", post(library_status))
        .route("/api/refresh", post(refresh))
        .route("/api/set_library_source", post(set_library_source))
        .route("/api/pair_confirm", post(pair_confirm))
        .route("/api/pair_start", post(pair_start))
        .route("/api/sync_exchange", post(sync_exchange))
        .route("/api/sync_reply", post(sync_reply))
        .route("/api/sync_status", post(sync_status))
        .route("/api/unpair", post(unpair))
        .route("/api/write_backup", post(write_backup))
        // Imports and sync carry a whole library's links and boards.
        .layer(DefaultBodyLimit::max(256 * 1024 * 1024))
        .layer(middleware::from_fn(local_hosts_only))
        .with_state(state)
}

#[tokio::main]
async fn main() {
    let db = mixmap_core::paths::database_path();
    let store = Store::open(&db).unwrap_or_else(|e| panic!("cannot open {}: {e}", db.display()));
    println!("mixmap database: {}", db.display());
    let state = AppState::new(Source::Auto, store);
    let status = state.library.current().status();
    println!(
        "library: {} tracks{}",
        status.track_count,
        status
            .error
            .map(|e| format!(" (error: {e})"))
            .unwrap_or_default()
    );
    if let Err(e) = start_network(&state).await {
        eprintln!("network sync disabled: {e}");
    }
    let addr = std::env::var("MIXMAP_DEV_ADDR").unwrap_or_else(|_| ADDR.into());
    let listener = tokio::net::TcpListener::bind(&addr).await.expect("bind");
    println!("devserver listening on http://{addr}");
    axum::serve(listener, app(state.clone()))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .expect("serve");
    // Unregister from mDNS so other instances drop us right away.
    drop(
        state
            .network
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take(),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    fn fixture_app() -> Option<Router> {
        let db =
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/master.db");
        db.is_file().then(|| {
            app(AppState::new(
                Source::MasterDb { path: db },
                Store::open_in_memory().unwrap(),
            ))
        })
    }

    async fn send(app: &Router, method: &str, uri: &str) -> (StatusCode, Vec<u8>) {
        let req = Request::builder()
            .method(method)
            .uri(uri)
            .header("host", "localhost:5173")
            .body(Body::empty())
            .unwrap();
        let res = app.clone().oneshot(req).await.unwrap();
        let status = res.status();
        (
            status,
            res.into_body().collect().await.unwrap().to_bytes().to_vec(),
        )
    }

    #[tokio::test]
    async fn library_endpoints() {
        let Some(app) = fixture_app() else { return };
        let (st, body) = send(&app, "POST", "/api/library").await;
        assert_eq!(st, StatusCode::OK);
        let lib: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let tracks = &lib["tracks"];
        assert!(!tracks.as_array().unwrap().is_empty());
        assert!(tracks[0]["title"].is_string() && tracks[0]["filePath"].is_string());
        assert!(lib["playlists"].is_array() && lib["histories"].is_array());
        assert_eq!(lib["version"], 1);

        let req = Request::builder()
            .method("POST")
            .uri("/api/db_execute")
            .header("host", "127.0.0.1:5174")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"statements":[{"sql":"CREATE TABLE t (v)"},{"sql":"INSERT INTO t VALUES (?)","params":[7]}]}"#))
            .unwrap();
        assert_eq!(
            app.clone().oneshot(req).await.unwrap().status(),
            StatusCode::OK
        );
        let req = Request::builder()
            .method("POST")
            .uri("/api/db_query")
            .header("host", "127.0.0.1:5174")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"sql":"SELECT v FROM t"}"#))
            .unwrap();
        let res = app.clone().oneshot(req).await.unwrap();
        let rows: serde_json::Value =
            serde_json::from_slice(&res.into_body().collect().await.unwrap().to_bytes()).unwrap();
        assert_eq!(rows, serde_json::json!([{"v": 7}]));

        let req = Request::builder()
            .method("POST")
            .uri("/api/library_status")
            .header("host", "evil.example:5174")
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.clone().oneshot(req).await.unwrap().status(),
            StatusCode::FORBIDDEN
        );

        let (st, _) = send(&app, "GET", "/api/artwork/does-not-exist").await;
        assert_eq!(st, StatusCode::NO_CONTENT);
        let (st, _) = send(&app, "GET", "/api/artwork/x?size=huge").await;
        assert_eq!(st, StatusCode::BAD_REQUEST);
    }

    #[test]
    fn local_host_names() {
        for h in [
            "localhost:5173",
            "127.0.0.1:5174",
            "[::1]:5174",
            "localhost",
        ] {
            assert!(is_local_host(h), "{h}");
        }
        for h in [
            "",
            "evil.example",
            "localhost.evil.example:5174",
            "127.0.0.2:5174",
        ] {
            assert!(!is_local_host(h), "{h}");
        }
    }
}
