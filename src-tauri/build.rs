/// The app's own commands, declared in the app manifest: the WebView may call them
/// only with a permission in a capability (`allow-<command>`, capabilities/default.json).
const COMMANDS: &[&str] = &[
    "call",
    "overlay_hotkey",
    "set_overlay_hotkey",
    "overlay_hidden",
    "show_main",
    "update_check",
    "update_install",
];

fn main() {
    // The exe's version comes from package.json (tauri.conf.json has
    // `"version": "../package.json"`), but tauri-build only reruns when
    // tauri.conf.json changes: without this a version stamp would not reach the
    // Windows resource on incremental builds.
    println!("cargo:rerun-if-changed=../package.json");
    // Same for the icons (the .ico goes into the Windows resource).
    println!("cargo:rerun-if-changed=icons");
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
