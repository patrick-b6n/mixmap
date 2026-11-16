import { type Db, now } from "./db";

/** Read a setting (stored as JSON); `undefined` if unset or unreadable. */
export async function getSetting<T>(db: Db, key: string): Promise<T | undefined> {
  const rows = await db.query<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]);
  const [row] = rows;
  if (!row) return undefined;
  try {
    return JSON.parse(row.value) as T;
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
