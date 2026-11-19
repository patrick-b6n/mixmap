// Controlling the overlay window of the desktop app (no-ops in the browser).
import { inTauri } from "./backend";

const CLICK_THROUGH_KEY = "mixmap.overlay.clickThrough";
export const OPACITY_KEY = "mixmap.overlay.opacity";

/** Overlay opacity 0.3–1 (remembered on this machine). */
export function loadOpacity(): number {
  try {
    const v = Number(localStorage.getItem(OPACITY_KEY));
    return v >= 0.3 && v <= 1 ? v : 0.95;
  } catch {
    return 0.95;
  }
}

export function saveOpacity(v: number): void {
  try {
    localStorage.setItem(OPACITY_KEY, String(v));
  } catch {
    // not remembered
  }
}

export function clickThrough(): boolean {
  try {
    return localStorage.getItem(CLICK_THROUGH_KEY) === "1";
  } catch {
    return false;
  }
}

async function overlay() {
  const { Window } = await import("@tauri-apps/api/window");
  return Window.getByLabel("overlay");
}

export async function overlayVisible(): Promise<boolean> {
  if (!inTauri()) return false;
  return (await (await overlay())?.isVisible()) ?? false;
}

export async function showOverlay(): Promise<void> {
  const w = await overlay();
  await w?.show();
  // Keep the click-through setting it had.
  await w?.setIgnoreCursorEvents(clickThrough());
}

export async function hideOverlay(): Promise<void> {
  await (await overlay())?.hide();
  const { invoke } = await import("@tauri-apps/api/core");
  // Quits when the main window is closed too.
  await invoke("overlay_hidden");
}

export async function toggleOverlay(): Promise<boolean> {
  if (await overlayVisible()) {
    await hideOverlay();
    return false;
  }
  await showOverlay();
  return true;
}

/** Clicks pass through the overlay to the window below (turn off from the main window or hotkey). */
export async function setClickThrough(on: boolean): Promise<void> {
  try {
    localStorage.setItem(CLICK_THROUGH_KEY, on ? "1" : "0");
  } catch {
    // not remembered
  }
  await (await overlay())?.setIgnoreCursorEvents(on);
}

/** Bring up the main window (re-created if it was closed). */
export async function showMain(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("show_main");
}
