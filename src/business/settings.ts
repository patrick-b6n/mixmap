/**
 * Setting keys, in one place. Keys starting with `local.` belong to this machine
 * (paths etc.) and are never exported or synced.
 */
export const SETTINGS = {
  /** Where the rekordbox library comes from (`LibrarySource`). */
  librarySource: "local.library.source",
  /** Global hotkey that shows/hides the overlay (desktop app; read by the backend at start). */
  overlayHotkey: "local.overlay.hotkey",
} as const;

export const isLocalSetting = (key: string): boolean => key.startsWith("local.");
