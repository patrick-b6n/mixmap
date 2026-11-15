// When to offer an update of the desktop app.
import { isNewer } from "./calver";

/** `latest.json` of the newest GitHub Release. */
export type UpdateManifest = { sha256: string; size: number; title: string; url: string; version: string };

/** A manifest as fetched (null: no release yet; anything malformed is ignored). */
export function asManifest(v: unknown): UpdateManifest | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const m = v as Record<string, unknown>;
  if (
    typeof m.version !== "string" ||
    typeof m.url !== "string" ||
    typeof m.sha256 !== "string" ||
    typeof m.size !== "number"
  ) {
    return undefined;
  }
  return {
    sha256: m.sha256,
    size: m.size,
    title: typeof m.title === "string" ? m.title : m.version,
    url: m.url,
    version: m.version,
  };
}

/**
 * Offer the update now? Only for a newer CalVer build than the running one (dev builds
 * never), not after "Later" for that version, and never while the overlay is shown.
 */
export function shouldPrompt(
  manifest: UpdateManifest | undefined,
  current: string,
  overlayVisible: boolean,
  dismissed: string | undefined,
): boolean {
  if (!manifest || !isNewer(manifest.version, current)) return false;
  if (dismissed === manifest.version) return false;
  return !overlayVisible;
}
