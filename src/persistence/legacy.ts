import type { Migration } from "./bundled-migrations";
import type { SqlConnection } from "./connection";
import { createMigrationsTable, MIGRATIONS_TABLE, MigrationError } from "./migrator";
import type { SqlClient } from "./sql-client";
import { createSqlDb, type SqlDb } from "./sql-db";

/**
 * Databases from before Drizzle: their schema version is in `PRAGMA user_version`
 * (1 = boards, 2 = one graph), there is no `__migrations` table. Version 2 is
 * exactly the schema of migration `0000_init`.
 */
export const LEGACY_SCHEMA_VERSION = 2;

/** The tag of the migration that a version-2 database already has. */
export const INIT_MIGRATION = "0000_init";

/** Horizontal space between former boards when they are merged into one graph. */
export const BOARD_GAP = 400;

/**
 * Saves a snapshot of a version-1 database (boards and all) before it is upgraded,
 * because merging the boards into one graph can't be undone.
 */
export type LegacyBackup = (snapshot: unknown) => Promise<unknown>;

/**
 * Version 1 → 2: one graph instead of boards. Boards are laid out side by side (in tab
 * order, each shifted to start at its own top-left); a track on several boards keeps
 * its place on the first. Same rules as `nodesFromBoards` (old export files).
 */
const UPGRADE_TO_2 = [
  `CREATE TABLE nodes (
    track_key TEXT PRIMARY KEY REFERENCES tracks (key),
    x REAL NOT NULL,
    y REAL NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `WITH ext AS (
     SELECT b.id, b.position, b.created_at AS bc, MIN(n.x) AS minx, MAX(n.x) AS maxx, MIN(n.y) AS miny
     FROM boards b JOIN board_nodes n ON n.board_id = b.id GROUP BY b.id
   ), placed AS (
     SELECT id, position, bc, minx, miny,
       IFNULL(SUM(maxx - minx + ${BOARD_GAP}) OVER (
         ORDER BY position, bc, id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
       ), 0) AS dx
     FROM ext
   )
   INSERT OR IGNORE INTO nodes (track_key, x, y, created_at, updated_at)
   SELECT n.track_key, n.x - p.minx + p.dx, n.y - p.miny, n.created_at, n.updated_at
   FROM board_nodes n JOIN placed p ON p.id = n.board_id
   ORDER BY p.position, p.bc, p.id, n.created_at, n.track_key`,
  `DELETE FROM tombstones WHERE kind IN ('board', 'board_node')`,
  `DROP TABLE board_nodes`,
  `DROP TABLE boards`,
];

export type LegacyResult = "fresh" | "tracked" | "adopted";

/**
 * Brings a pre-Drizzle database under the migrator: a version-1 database is
 * backed up and upgraded to version 2, then `0000_init` is recorded as applied
 * (its tables are already there). A new database (`user_version` 0) and one the
 * migrator already tracks are left alone. Safe to run from two windows at once:
 * every step re-checks the state inside its transaction.
 */
export async function adoptLegacyDatabase(
  connection: SqlConnection,
  migrations: readonly Migration[],
  backup: LegacyBackup,
): Promise<LegacyResult> {
  if (await isTracked(connection)) return "tracked";
  const version = await userVersion(connection);
  if (version === 0) return "fresh";
  if (version > LEGACY_SCHEMA_VERSION) {
    throw new MigrationError(
      "unknown_migration",
      `mixmap.db has schema version ${version}, newer than this app (${LEGACY_SCHEMA_VERSION})`,
    );
  }
  const init = migrations[0];
  if (init?.tag !== INIT_MIGRATION) {
    throw new Error(`The first migration must be ${INIT_MIGRATION}, not ${init?.tag}`);
  }

  if (version === 1) {
    // If the backup fails, nothing is upgraded.
    await backup(await exportVersion1(createSqlDb(connection)));
    await connection.transaction(async (client) => {
      if ((await userVersion(client)) !== 1) return;
      for (const statement of UPGRADE_TO_2) await client.execute(statement);
      await client.execute(`PRAGMA user_version = ${LEGACY_SCHEMA_VERSION}`);
    });
  }

  return connection.transaction(async (client): Promise<LegacyResult> => {
    if (await isTracked(client)) return "tracked";
    await createMigrationsTable(client);
    await client.execute(`INSERT INTO ${MIGRATIONS_TABLE} (idx, tag, hash, applied_at) VALUES (?, ?, ?, ?)`, [
      0,
      init.tag,
      init.hash,
      new Date().toISOString(),
    ]);
    return "adopted";
  });
}

async function isTracked(client: SqlClient): Promise<boolean> {
  const rows = await client.select("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?", [
    MIGRATIONS_TABLE,
  ]);
  return rows.length > 0;
}

async function userVersion(client: SqlClient): Promise<number> {
  const [row] = await client.select("PRAGMA user_version");
  return Number(row?.user_version ?? 0);
}

const parseJson = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};

/**
 * A schema-version-1 database as a version 1 `.mixmap.json` (boards and all), so the
 * data from before the upgrade can still be read: this app imports it as one graph,
 * an older mixmap restores the boards. Manual matches keep their rekordbox id only.
 */
export async function exportVersion1(db: SqlDb, exportedAt = Date.now()): Promise<unknown> {
  const [tracks, links, boards, boardNodes, manualMatches, tombstones, settings] = await Promise.all([
    db.query<Record<string, number | string>>("SELECT * FROM tracks ORDER BY key"),
    db.query<Record<string, number | string | null>>("SELECT * FROM links ORDER BY from_track, to_track"),
    db.query<Record<string, number | string>>("SELECT * FROM boards ORDER BY position, id"),
    db.query<Record<string, number | string>>("SELECT * FROM board_nodes ORDER BY board_id, track_key"),
    db.query<Record<string, number | string>>("SELECT * FROM manual_matches ORDER BY track_key"),
    db.query<Record<string, number | string>>("SELECT * FROM tombstones ORDER BY kind, id"),
    db.query<{ key: string; updated_at: number; value: string }>("SELECT * FROM settings ORDER BY key"),
  ]);
  return {
    boardNodes: boardNodes.map((n) => ({
      boardId: n.board_id,
      createdAt: n.created_at,
      trackKey: n.track_key,
      updatedAt: n.updated_at,
      x: n.x,
      y: n.y,
    })),
    boards: boards.map((b) => ({
      createdAt: b.created_at,
      id: b.id,
      name: b.name,
      position: b.position,
      updatedAt: b.updated_at,
    })),
    exportedAt,
    format: "mixmap",
    links: links.map((l) => {
      const tags = parseJson(String(l.tags));
      return {
        comment: l.comment,
        createdAt: l.created_at,
        from: l.from_track,
        rating: l.rating,
        tags: Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string") : [],
        to: l.to_track,
        updatedAt: l.updated_at,
      };
    }),
    manualMatches: manualMatches.map((m) => ({
      createdAt: m.created_at,
      rekordboxId: m.rekordbox_id,
      targetKey: null,
      trackKey: m.track_key,
      updatedAt: m.updated_at,
    })),
    settings: settings
      // Machine-local settings are never exported.
      .filter((s) => !s.key.startsWith("local."))
      .map((s) => ({ key: s.key, updatedAt: s.updated_at, value: parseJson(s.value) })),
    tombstones: tombstones.map((t) => ({ deletedAt: t.deleted_at, id: t.id, kind: t.kind })),
    tracks: tracks.map((t) => ({
      artist: t.artist,
      createdAt: t.created_at,
      duration: t.duration,
      key: t.key,
      title: t.title,
      updatedAt: t.updated_at,
    })),
    version: 1,
  };
}
