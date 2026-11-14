//! Local HTTP server exposing the same API as the (future) Tauri commands.
//! Every command is `POST /api/<command>` with a JSON body. Backend events are
//! streamed as server-sent events on `GET /api/events` (Tauri: `emit`).
//! No CORS: the UI reaches it through the Vite proxy (same origin), so other websites
//! cannot read it.

use std::convert::Infallible;
use std::sync::{Arc, Mutex};

use axum::{
    extract::State,
    http::StatusCode,
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::{get, post},
    Json, Router,
};
use mixmap_core::service::{LibraryService, Status};
use mixmap_core::Error;
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
    events: broadcast::Sender<BackendEvent>,
    library: Arc<LibraryService>,
    /// Keeps the master.db watcher alive.
    watcher: Arc<Mutex<Option<Box<dyn Send>>>>,
}

impl AppState {
    fn new() -> Self {
        let (events, _) = broadcast::channel(64);
        let state = Self {
            events,
            library: LibraryService::new(None),
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
                eprintln!("not watching master.db: {e}");
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

fn app(state: AppState) -> Router {
    Router::new()
        .route("/api/events", get(events))
        .route("/api/hello", post(|| async { Json(mixmap_core::hello()) }))
        .route("/api/library_location", post(library_location))
        .route("/api/library_status", post(library_status))
        .route("/api/refresh", post(refresh))
        .with_state(state)
}

#[tokio::main]
async fn main() {
    let state = AppState::new();
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
