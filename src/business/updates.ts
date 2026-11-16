// When to offer an update of the desktop app.

/** Result of the backend's `update_check` (src-tauri/src/updater.rs). */
export type UpdateCheck = {
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string | null;
  title: string | null;
  /** The latest release is newer than the running app (never for development builds). */
  updateAvailable: boolean;
};

/**
 * Offer the update now? Only when a newer release exists, not after "Later" for that
 * version, and never while the overlay is shown.
 */
export function shouldPrompt(
  check: UpdateCheck | undefined,
  overlayVisible: boolean,
  dismissed: string | undefined,
): boolean {
  if (!check?.updateAvailable || check.latestVersion === null) return false;
  if (dismissed === check.latestVersion) return false;
  return !overlayVisible;
}
