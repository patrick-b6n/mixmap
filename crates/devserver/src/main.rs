//! Local HTTP server exposing the same API as the (future) Tauri commands.
//! Every command is `POST /api/<command>` with a JSON body. No CORS: the UI reaches
//! it through the Vite proxy (same origin), so other websites cannot read it.

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use mixmap_core::Error;

const ADDR: &str = "127.0.0.1:5174";

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

fn app() -> Router {
    Router::new()
        .route("/api/hello", post(|| async { Json(mixmap_core::hello()) }))
        .route("/api/library_location", post(library_location))
}

#[tokio::main]
async fn main() {
    let listener = tokio::net::TcpListener::bind(ADDR).await.expect("bind");
    println!("devserver listening on http://{ADDR}");
    axum::serve(listener, app()).await.expect("serve");
}
