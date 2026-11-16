//! mixmap desktop app: the Tauri host and the backend behind the UI.
//!
//! The UI talks to the backend through one command, `call(command, args)`, dispatched by
//! [`app::App`]. Backend events are Tauri events of the same name. Artwork is served by
//! the `artwork` URI scheme (`http://artwork.localhost/<track id>?size=small|large`).
//!
//! mixmap's own database (`mixmap.db`) belongs to the UI: the host only opens it with a
//! single connection and hands it to `tauri-plugin-sql` ([`register_database`]); schema,
//! migrations and queries live in TypeScript (`src/persistence`).

use std::sync::{Arc, OnceLock};

pub mod app;
pub mod artwork;
pub mod backups;
mod error;
mod hotkey;
pub mod memory;
pub mod network;
pub mod nowplaying;
pub mod paths;
pub mod rekordbox;
pub mod service;
mod updater;

pub use error::Error;

use app::App;
use artwork::Size;
use serde::Serialize;
use serde_json::Value;
use service::Source;
use tauri::http::{Response, StatusCode, header};
use tauri::{Emitter, Manager, RunEvent, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_window_state::StateFlags;

/// The app version (from package.json via tauri.conf.json), set once at startup.
static VERSION: OnceLock<String> = OnceLock::new();

#[derive(Debug, Serialize)]
pub struct Hello {
    pub message: String,
    pub version: String,
}

pub fn hello() -> Hello {
    Hello {
        message: "hello from mixmap".into(),
        version: VERSION.get().cloned().unwrap_or_else(|| "0.0.0".into()),
    }
}

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
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && let Ok(b) = std::str::from_utf8(&bytes[i + 1..i + 3])
                .ok()
                .and_then(|h| u8::from_str_radix(h, 16).ok())
                .ok_or(())
        {
            out.push(b);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Name under which the database is registered with `tauri-plugin-sql`. The UI opens it
/// with `Database.get(DB_NAME)` (src/persistence/tauri-sql-client.ts).
pub const DB_NAME: &str = "sqlite:mixmap.db";

pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(if cfg!(debug_assertions) {
                    log::LevelFilter::Info
                } else {
                    log::LevelFilter::Warn
                })
                .build(),
        )
        .plugin(tauri_plugin_sql::Builder::new().build())
        // Position and size of both windows; visibility isn't restored (the overlay
        // starts hidden, the main window shown).
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() - StateFlags::VISIBLE)
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(hotkey::on_shortcut)
                .build(),
        )
        .manage(hotkey::Current::default())
        .on_window_event(|window, event| {
            // Closing the main window while the overlay is shown keeps the app running.
            if let (WindowEvent::CloseRequested { .. }, "main") = (event, window.label())
                && !overlay_visible(window.app_handle())
            {
                window.app_handle().exit(0);
            }
        })
        .setup(move |tauri_app| {
            let _ = VERSION.set(tauri_app.package_info().version.to_string());
            // Left over by a self-update.
            updater::cleanup_old();
            // Without a pool the UI gets "database not loaded" and shows its startup
            // error screen; the cause is in the log.
            let pool = match tauri::async_runtime::block_on(register_database(tauri_app.handle())) {
                Ok(pool) => Some(pool),
                Err(e) => {
                    log::error!("could not open the database: {e}");
                    None
                }
            };
            let handle = tauri_app.handle().clone();
            let app = App::new(
                Source::Auto,
                Arc::new(move |name, payload| {
                    let _ = handle.emit(name, payload);
                }),
            );
            tauri_app.manage(app.clone());
            // The overlay hotkey (saved one or the default).
            let accelerator = tauri::async_runtime::block_on(hotkey::saved(pool.as_ref()));
            if let Err(e) = hotkey::register(tauri_app.handle(), &accelerator) {
                eprintln!("overlay hotkey: {e}");
            }
            tauri::async_runtime::spawn(async move { app.start_background().await });
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol("artwork", |ctx, request, responder| {
            let app = ctx.app_handle().state::<Arc<App>>().inner().clone();
            let uri = request.uri().clone();
            std::thread::spawn(move || responder.respond(artwork_response(&app, &uri)));
        })
        .invoke_handler(tauri::generate_handler![
            call,
            hotkey::overlay_hotkey,
            hotkey::set_overlay_hotkey,
            overlay_hidden,
            show_main,
            updater::update_install,
            updater::update_manifest
        ])
        .build(tauri::generate_context!())
        .expect("error while building mixmap")
        .run(|handle, event| {
            if let RunEvent::Exit = event {
                // Unregister from mDNS so other devices drop us right away.
                handle.state::<Arc<App>>().shutdown();
            }
        });
}

/// Opens `mixmap.db` with a pool of exactly one connection and hands it to
/// `tauri-plugin-sql` (its own `load` always creates a pool of up to ten connections).
///
/// One connection is required: the UI runs `PRAGMA`s and transactions as separate
/// `execute` calls, which only work if they all hit the same connection
/// (docs/data-model.md). The connection is never recycled, so an open transaction
/// cannot get lost between two calls. Returns the pool for the host's own reads.
async fn register_database(
    app: &tauri::AppHandle,
) -> Result<sqlx::SqlitePool, Box<dyn std::error::Error>> {
    use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
    use tauri_plugin_sql::{DbInstances, DbPool};

    let file = paths::database_path();
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    log::info!("database file: {}", file.display());
    let options = SqliteConnectOptions::new()
        .filename(file)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(std::time::Duration::from_secs(5))
        .foreign_keys(true)
        .pragma("trusted_schema", "OFF");
    let pool = SqlitePoolOptions::new()
        .min_connections(1)
        .max_connections(1)
        .idle_timeout(None)
        .max_lifetime(None)
        .connect_with(options)
        .await?;
    app.state::<DbInstances>()
        .0
        .write()
        .await
        .insert(DB_NAME.to_string(), DbPool::Sqlite(pool.clone()));
    Ok(pool)
}

#[cfg(test)]
mod tests {
    use super::percent_decode;

    #[test]
    fn hello_has_message() {
        assert!(super::hello().message.contains("hello"));
    }

    #[test]
    fn decodes_ids() {
        assert_eq!(percent_decode("123"), "123");
        assert_eq!(percent_decode("a%20b"), "a b");
        assert_eq!(percent_decode("bad%zz"), "bad%zz");
        assert_eq!(percent_decode("end%2"), "end%2");
    }
}
