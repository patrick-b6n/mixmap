//! Local HTTP server exposing the same API as the (future) Tauri commands.
//! Every command is `POST /api/<command>` with a JSON body. No CORS: the UI reaches
//! it through the Vite proxy (same origin), so other websites cannot read it.

use axum::{routing::post, Json, Router};

const ADDR: &str = "127.0.0.1:5174";

fn app() -> Router {
    Router::new().route("/api/hello", post(|| async { Json(mixmap_core::hello()) }))
}

#[tokio::main]
async fn main() {
    let listener = tokio::net::TcpListener::bind(ADDR).await.expect("bind");
    println!("devserver listening on http://{ADDR}");
    axum::serve(listener, app()).await.expect("serve");
}
