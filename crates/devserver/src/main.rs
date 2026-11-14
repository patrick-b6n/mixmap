//! Local HTTP server exposing the same API as the (future) Tauri commands.
//! Every command is `POST /api/<command>` with a JSON body. Backend events are
//! streamed as server-sent events on `GET /api/events` (Tauri: `emit`).
//! No CORS: the UI reaches it through the Vite proxy (same origin), so other websites
//! cannot read it.

use std::convert::Infallible;
use std::sync::{Arc, Mutex};

use axum::{
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::{get, post},
    Json, Router,
};
use mixmap_core::artwork::{ArtworkCache, Size};
use mixmap_core::rekordbox::library::Track;
use mixmap_core::rekordbox::playlists::Playlist;
use mixmap_core::service::{LibraryService, Source, Status};
use mixmap_core::Error;
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;
use tokio_stream::{wrappers::BroadcastStream, Stream, StreamExt};

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
    /// Keeps the master.db watcher alive.
    watcher: Arc<Mutex<Option<Box<dyn Send>>>>,
}

impl AppState {
    fn new(source: Source) -> Self {
        let (events, _) = broadcast::channel(64);
        let state = Self {
            artwork: Arc::new(ArtworkCache::new(mixmap_core::paths::artwork_dir())),
            events,
            library: LibraryService::new(source),
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

fn app(state: AppState) -> Router {
    Router::new()
        .route("/api/artwork/{track_id}", get(artwork))
        .route("/api/events", get(events))
        .route("/api/hello", post(|| async { Json(mixmap_core::hello()) }))
        .route("/api/library", post(library))
        .route("/api/library_location", post(library_location))
        .route("/api/library_status", post(library_status))
        .route("/api/refresh", post(refresh))
        .route("/api/set_library_source", post(set_library_source))
        .with_state(state)
}

#[tokio::main]
async fn main() {
    let state = AppState::new(Source::Auto);
    let status = state.library.current().status();
    println!(
        "library: {} tracks{}",
        status.track_count,
        status
            .error
            .map(|e| format!(" (error: {e})"))
            .unwrap_or_default()
    );
    let listener = tokio::net::TcpListener::bind(ADDR).await.expect("bind");
    println!("devserver listening on http://{ADDR}");
    axum::serve(listener, app(state)).await.expect("serve");
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
        db.is_file()
            .then(|| app(AppState::new(Source::MasterDb { path: db })))
    }

    async fn send(app: &Router, method: &str, uri: &str) -> (StatusCode, Vec<u8>) {
        let req = Request::builder()
            .method(method)
            .uri(uri)
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

        let (st, _) = send(&app, "GET", "/api/artwork/does-not-exist").await;
        assert_eq!(st, StatusCode::NO_CONTENT);
        let (st, _) = send(&app, "GET", "/api/artwork/x?size=huge").await;
        assert_eq!(st, StatusCode::BAD_REQUEST);
    }
}
