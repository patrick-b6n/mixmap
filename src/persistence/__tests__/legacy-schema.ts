/** The schema of a version-1 database (boards), as mixmap created it before Drizzle. */
export const VERSION_1_SCHEMA: string[] = [
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
];
