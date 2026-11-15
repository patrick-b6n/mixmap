//! MixMap desktop app: a thin Tauri shell over `mixmap_core::app::App`.
//!
//! The UI talks to the backend through one command, `call(command, args)` (the same
//! commands the devserver serves as `POST /api/<command>`). Backend events are Tauri
//! events of the same name. Artwork is served by the `artwork` URI scheme
//! (`http://artwork.localhost/<track id>?size=small|large`).

use std::sync::Arc;

use mixmap_core::app::App;
use mixmap_core::artwork::Size;
use mixmap_core::service::Source;
use mixmap_core::store::Store;
use serde_json::Value;
use tauri::http::{header, Response, StatusCode};
use tauri::{Emitter, Manager, RunEvent, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_window_state::StateFlags;

/// The single backend command. Errors are returned as their message.
#[tauri::command]
async fn call(
    app: tauri::State<'_, Arc<App>>,
    command: String,
    args: Option<Value>,
) -> Result<Value, String> {
    app.call(&command, args.unwrap_or(Value::Null))
        .await
        .map_err(|e| e.to_string())
}

/// Show the main window, re-creating it if it was closed (the overlay can run alone).
/// Async: creating a window in a synchronous command deadlocks on Windows.
#[tauri::command]
async fn show_main(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        w.show().map_err(|e| e.to_string())?;
        return w.set_focus().map_err(|e| e.to_string());
    }
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "main")
        .cloned()
        .ok_or("no main window configured")?;
    WebviewWindowBuilder::from_config(&app, &config)
        .and_then(|b| b.build())
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// The overlay was hidden: quit when no main window is left either.
#[tauri::command]
fn overlay_hidden(app: tauri::AppHandle) {
    if app.get_webview_window("main").is_none() {
        app.exit(0);
    }
}

fn overlay_visible(app: &tauri::AppHandle) -> bool {
    app.get_webview_window("overlay")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
}

fn artwork_response(app: &Arc<App>, uri: &tauri::http::Uri) -> Response<Vec<u8>> {
    let id = uri.path().trim_start_matches('/').to_string();
    let id = percent_decode(&id);
    let size = if uri
        .query()
        .is_some_and(|q| q.split('&').any(|p| p == "size=large"))
    {
        Size::Large
    } else {
        Size::Small
    };
    let result = tauri::async_runtime::block_on(app.artwork(id, size));
    let builder = Response::builder().header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*");
    match result {
        Ok(Some(bytes)) => builder
            .header(header::CONTENT_TYPE, "image/jpeg")
            .header(
                header::CACHE_CONTROL,
                "private, max-age=31536000, immutable",
            )
            .body(bytes),
        Ok(None) => builder.status(StatusCode::NO_CONTENT).body(vec![]),
        Err(e) => builder
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(e.to_string().into_bytes()),
    }
    .unwrap_or_else(|_| Response::new(vec![]))
}

/// Track ids are plain, but decode %XX just in case.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = std::str::from_utf8(&bytes[i + 1..i + 3])
                .ok()
                .and_then(|h| u8::from_str_radix(h, 16).ok())
                .ok_or(())
            {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub fn run() {
    let db = mixmap_core::paths::database_path();
    let store = Store::open(&db).unwrap_or_else(|e| panic!("cannot open {}: {e}", db.display()));

    tauri::Builder::default()
        // Position and size of both windows; visibility isn't restored (the overlay
        // starts hidden, the main window shown).
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() - StateFlags::VISIBLE)
                .build(),
        )
        .on_window_event(|window, event| {
            // Closing the main window while the overlay is shown keeps the app running.
            if let (WindowEvent::CloseRequested { .. }, "main") = (event, window.label()) {
                if !overlay_visible(window.app_handle()) {
                    window.app_handle().exit(0);
                }
            }
        })
        .setup(move |tauri_app| {
            let handle = tauri_app.handle().clone();
            let app = App::new(
                Source::Auto,
                store,
                Arc::new(move |name, payload| {
                    let _ = handle.emit(name, payload);
                }),
            );
            tauri_app.manage(app.clone());
            tauri::async_runtime::spawn(async move { app.start_background().await });
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol("artwork", |ctx, request, responder| {
            let app = ctx.app_handle().state::<Arc<App>>().inner().clone();
            let uri = request.uri().clone();
            std::thread::spawn(move || responder.respond(artwork_response(&app, &uri)));
        })
        .invoke_handler(tauri::generate_handler![call, overlay_hidden, show_main])
        .build(tauri::generate_context!())
        .expect("error while building MixMap")
        .run(|handle, event| {
            if let RunEvent::Exit = event {
                // Unregister from mDNS so other devices drop us right away.
                handle.state::<Arc<App>>().shutdown();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::percent_decode;

    #[test]
    fn decodes_ids() {
        assert_eq!(percent_decode("123"), "123");
        assert_eq!(percent_decode("a%20b"), "a b");
        assert_eq!(percent_decode("bad%zz"), "bad%zz");
        assert_eq!(percent_decode("end%2"), "end%2");
    }
}
