//! The LAN listener (all interfaces, OS-assigned port, advertised via mDNS). It only
//! serves sync endpoints; the local API (raw SQL bridge etc.) stays on localhost.

use axum::{routing::get, Json, Router};
use serde::Serialize;
use tokio::net::TcpListener;

use super::{Device, PROTOCOL};
use crate::Error;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hello {
    pub id: String,
    pub name: String,
    pub protocol: u32,
}

/// Routes other instances may call.
pub fn router(me: Device) -> Router {
    Router::new().route(
        "/sync/hello",
        get(move || {
            let me = me.clone();
            async move {
                Json(Hello {
                    id: me.id,
                    name: me.name,
                    protocol: PROTOCOL,
                })
            }
        }),
    )
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

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn hello_answers_with_identity() {
        let (listener, port) = bind().await.unwrap();
        let me = Device {
            id: "abc".into(),
            name: "Studio".into(),
        };
        tokio::spawn(async move { axum::serve(listener, router(me)).await });
        let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .unwrap();
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        stream
            .write_all(b"GET /sync/hello HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")
            .await
            .unwrap();
        let mut body = String::new();
        stream.read_to_string(&mut body).await.unwrap();
        assert!(body.starts_with("HTTP/1.1 200"), "{body}");
        assert!(
            body.contains(r#"{"id":"abc","name":"Studio","protocol":1}"#),
            "{body}"
        );
    }
}
