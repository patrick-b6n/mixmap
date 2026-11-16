//! Local HTTP server exposing the same API as the Tauri commands, for the browser dev
//! loop. Every command is `POST /api/<command>` with a JSON body (handled by
//! `mixmap_core::app::App::call`). Backend events are streamed as server-sent events
//! on `GET /api/events`. No CORS: the UI reaches it through the Vite proxy (same
//! origin), so other websites cannot read it.

use std::convert::Infallible;
use std::sync::Arc;

use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Path, Query, Request, State},
    http::{header, StatusCode},
    middleware::{self, Next},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::{get, post},
    Router,
};
use mixmap_core::app::App;
use mixmap_core::artwork::Size;
use mixmap_core::service::Source;
use mixmap_core::store::Store;
use mixmap_core::Error;
use serde::Deserialize;
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
    app: Arc<App>,
    events: broadcast::Sender<BackendEvent>,
}

impl AppState {
    fn new(source: Source, store: Store) -> Self {
        let (events, _) = broadcast::channel(64);
        let tx = events.clone();
        let app = App::new(
            source,
            store,
            Arc::new(move |name, payload| {
                // No receivers is fine.
                let _ = tx.send(BackendEvent {
                    data: payload.to_string(),
                    name,
                });
            }),
        );
        // A sync request can only be answered while a UI listens for events.
        let listeners = events.clone();
        app.set_ui_presence(Arc::new(move || listeners.receiver_count() > 0));
        Self { app, events }
    }
}

fn error_response(e: Error) -> Response {
    let status = match e {
        Error::Invalid(_) => StatusCode::BAD_REQUEST,
        // Not 404: that would look like a missing route.
        Error::NotFound(_) => StatusCode::UNPROCESSABLE_ENTITY,
        Error::Forbidden(_) => StatusCode::FORBIDDEN,
    };
    (status, e.to_string()).into_response()
}

/// `POST /api/<command>`: JSON arguments in, JSON result out.
async fn command(State(s): State<AppState>, Path(name): Path<String>, body: Bytes) -> Response {
    let args = if body.is_empty() {
        serde_json::Value::Null
    } else {
        match serde_json::from_slice(&body) {
            Ok(v) => v,
            Err(e) => return error_response(Error::Invalid(format!("bad JSON: {e}"))),
        }
    };
    match s.app.call(&name, args).await {
        Ok(v) => match serde_json::to_vec(&v) {
            Ok(bytes) => ([(header::CONTENT_TYPE, "application/json")], bytes).into_response(),
            Err(e) => error_response(Error::Invalid(e.to_string())),
        },
        Err(Error::NotFound(m)) if m.starts_with("unknown command") => {
            (StatusCode::NOT_FOUND, m).into_response()
        }
        Err(e) => error_response(e),
    }
}

async fn events(State(s): State<AppState>) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let app = s.app.clone();
    let stream = BroadcastStream::new(s.events.subscribe()).map(move |e| {
        let e = e.unwrap_or_else(|_lagged| BackendEvent {
            // This client missed events: resync it with the current library status.
            data: app.library_status().to_string(),
            name: "library",
        });
        Ok(Event::default().event(e.name).data(e.data))
    });
    Sse::new(stream).keep_alive(KeepAlive::default())
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
    match s.app.artwork(track_id, q.size.unwrap_or(Size::Small)).await {
        Ok(Some(bytes)) => (
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
        Err(e) => {
            eprintln!("{e}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
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
        .route("/api/events", get(events))
        .route("/api/{command}", post(command))
        // Imports and sync carry a whole library's links and graph positions.
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
    let status = state.app.library_status();
    println!(
        "library: {} tracks{}",
        status["trackCount"],
        status["error"]
            .as_str()
            .map(|e| format!(" (error: {e})"))
            .unwrap_or_default()
    );
    state.app.start_background().await;
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
    state.app.shutdown();
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

    #[tokio::test(flavor = "multi_thread")]
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

        let (st, _) = send(&app, "POST", "/api/no_such_command").await;
        assert_eq!(st, StatusCode::NOT_FOUND);
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
