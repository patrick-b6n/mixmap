//! Global hotkey that shows/hides the overlay (default Ctrl+Alt+M). The chosen hotkey
//! is a machine-local setting (`local.overlay.hotkey` in mixmap.db, written by the UI).

use std::str::FromStr;
use std::sync::Mutex;

use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub const DEFAULT: &str = "Ctrl+Alt+M";
pub const SETTING: &str = "local.overlay.hotkey";

/// The registered hotkey as the user wrote it.
#[derive(Default)]
pub struct Current(pub Mutex<Option<String>>);

/// A hotkey needs at least one modifier besides Shift (so typing isn't hijacked).
pub fn parse(s: &str) -> Result<Shortcut, String> {
    let shortcut = Shortcut::from_str(s.trim()).map_err(|e| format!("not a valid hotkey: {e}"))?;
    use tauri_plugin_global_shortcut::Modifiers;
    let m = shortcut.mods;
    if !(m.contains(Modifiers::CONTROL)
        || m.contains(Modifiers::ALT)
        || m.contains(Modifiers::SUPER))
    {
        return Err("use Ctrl, Alt or Win in the hotkey".into());
    }
    Ok(shortcut)
}

/// Show or hide the overlay. Hiding keeps the app running (the hotkey brings it back).
pub fn toggle_overlay(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("overlay") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            let _ = w.show();
        }
    }
}

/// Register `accelerator` instead of the current hotkey. On failure the old one stays.
pub fn register(app: &AppHandle, accelerator: &str) -> Result<String, String> {
    let shortcut = parse(accelerator)?;
    let gs = app.global_shortcut();
    let state = app.state::<Current>();
    let mut current = state.0.lock().unwrap_or_else(|e| e.into_inner());
    let old = current.as_deref().and_then(|s| parse(s).ok());
    if old.as_ref() == Some(&shortcut) {
        return Ok(accelerator.trim().to_string());
    }
    if let Some(old) = &old {
        let _ = gs.unregister(*old);
    }
    let mut result = gs.register(shortcut);
    // Right after a self-update the previous process may still hold it briefly.
    for _ in 0..10 {
        if result.is_ok() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(300));
        result = gs.register(shortcut);
    }
    if let Err(e) = result {
        if let Some(old) = old {
            let _ = gs.register(old);
        }
        return Err(format!(
            "{accelerator} can't be used (taken by another app?): {e}"
        ));
    }
    *current = Some(accelerator.trim().to_string());
    Ok(accelerator.trim().to_string())
}

/// The saved hotkey, or the default (also when mixmap.db isn't set up yet).
pub async fn saved(pool: Option<&sqlx::SqlitePool>) -> String {
    let value: Option<String> = match pool {
        Some(pool) => sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
            .bind(SETTING)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten(),
        None => None,
    };
    value
        .and_then(|v| serde_json::from_str::<String>(&v).ok())
        .filter(|v| parse(v).is_ok())
        .unwrap_or_else(|| DEFAULT.into())
}

/// Handler for the global-shortcut plugin: toggle on key down.
pub fn on_shortcut(
    app: &AppHandle,
    _shortcut: &Shortcut,
    event: tauri_plugin_global_shortcut::ShortcutEvent,
) {
    if event.state == ShortcutState::Pressed {
        toggle_overlay(app);
    }
}

#[tauri::command]
pub fn set_overlay_hotkey(app: AppHandle, accelerator: String) -> Result<String, String> {
    register(&app, &accelerator)
}

#[tauri::command]
pub fn overlay_hotkey(app: AppHandle) -> String {
    app.state::<Current>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
        .unwrap_or_else(|| DEFAULT.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_requires_a_real_modifier() {
        assert!(parse("Ctrl+Alt+M").is_ok());
        assert!(parse("ctrl+shift+F9").is_ok());
        assert!(parse(" Alt+O ").is_ok());
        assert!(parse("M").is_err());
        assert!(parse("Shift+M").is_err());
        assert!(parse("Ctrl+Alt+").is_err());
        assert!(parse("Hyper+Q").is_err());
    }
}
