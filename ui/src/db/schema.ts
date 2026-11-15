import type { Db } from "./db";

/**
 * Schema migrations, applied in order; `PRAGMA user_version` holds how many ran.
 * Each migration is a list of statements. Never edit a released migration: add one.
 *
 * Identity (so rows merge across machines without collisions):
 * - tracks: the portable key (normalized artist|title|seconds), see domain/matching
 * - links: (from_track, to_track), at most one per direction
 * - boards: UUID; board_nodes: (board_id, track_key)
 * - manual_matches: portable key → this machine's rekordbox id
 * Timestamps are milliseconds since the epoch; `rekordbox_id`/`missing` on tracks
 * are a machine-local cache.
 *
 * Deleting a synced row records a tombstone (kind, id, deleted_at). Tombstone ids:
 * track `<key>`, link `<from>\u0001<to>`, board `<id>`, board_node
 * `<board_id>\u0001<track_key>`, manual_match `<key>` — see `tombstoneId`.
 */
export const MIGRATIONS: string[][] = [
  // 1: initial schema
  [
    `CREATE TABLE tracks (
      key TEXT PRIMARY KEY,
      artist TEXT NOT NULL,
      title TEXT NOT NULL,
      duration INTEGER NOT NULL,
      rekordbox_id TEXT,
      missing INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE links (
      from_track TEXT NOT NULL REFERENCES tracks (key),
      to_track TEXT NOT NULL REFERENCES tracks (key),
      comment TEXT NOT NULL DEFAULT '',
      rating INTEGER CHECK (rating BETWEEN 1 AND 5),
      tags TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (from_track, to_track),
      CHECK (from_track <> to_track)
    )`,
    `CREATE INDEX links_to_track ON links (to_track)`,
    `CREATE TABLE boards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE board_nodes (
      board_id TEXT NOT NULL REFERENCES boards (id),
      track_key TEXT NOT NULL REFERENCES tracks (key),
      x REAL NOT NULL,
      y REAL NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (board_id, track_key)
    )`,
    `CREATE TABLE manual_matches (
      track_key TEXT PRIMARY KEY,
      rekordbox_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE tombstones (
      kind TEXT NOT NULL,
      id TEXT NOT NULL,
      deleted_at INTEGER NOT NULL,
      PRIMARY KEY (kind, id)
    )`,
    `CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
  ],
];

export type TombstoneKind = "board" | "board_node" | "link" | "manual_match" | "track";

/** Tombstone id of a row: its natural key, parts joined with U+0001. */
export function tombstoneId(...keyParts: string[]): string {
  return keyParts.join("\u0001");
}

async function schemaVersion(db: Db): Promise<number> {
  const [{ user_version }] = await db.query<{ user_version: number }>("PRAGMA user_version");
  return user_version;
}

/**
 * Apply pending migrations. Returns the resulting schema version. Safe to call
 * concurrently (e.g. two windows): a migration that fails because another caller
 * already applied it is skipped.
 */
export async function migrate(db: Db): Promise<number> {
  const current = await schemaVersion(db);
  if (current > MIGRATIONS.length) {
    throw new Error(`mixmap.db has schema version ${current}, newer than this app (${MIGRATIONS.length})`);
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    const statements = MIGRATIONS[v].map((sql) => ({ sql }));
    try {
      // Each migration and its version bump commit together.
      await db.execute([...statements, { sql: `PRAGMA user_version = ${v + 1}` }]);
    } catch (e) {
      if ((await schemaVersion(db)) <= v) throw e;
    }
  }
  return MIGRATIONS.length;
}
