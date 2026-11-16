import { type Db, now } from "./db";

/** Read a setting (stored as JSON); `undefined` if unset or unreadable. */
export async function getSetting<T>(db: Db, key: string): Promise<T | undefined> {
  const rows = await db.query<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]);
  if (rows.length === 0) return undefined;
  try {
    return JSON.parse(rows[0].value) as T;
  } catch {
    return undefined;
  }
}

/** Write a setting (any JSON value). */
export async function setSetting(db: Db, key: string, value: unknown): Promise<void> {
  await db.execute([
    {
      params: [key, JSON.stringify(value), now()],
      sql: `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
            ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    },
  ]);
}

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
