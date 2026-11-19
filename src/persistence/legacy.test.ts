import { describe, expect, it, vi } from "vitest";

import { checkExport } from "@/business/exchange";

import { createNodeSqliteClient, memorySqlite } from "@/persistence/__tests__/node-sqlite-client";
import { VERSION_1_SCHEMA } from "@/persistence/__tests__/legacy-schema";
import { loadMigrations } from "./bundled-migrations";
import { INIT_MIGRATION, LEGACY_SCHEMA_VERSION, type LegacyBackup } from "./legacy";
import { MIGRATIONS_TABLE } from "./migrator";
import { openDatabase } from "./open-database";

/** A database as mixmap created it before Drizzle, at schema version 1 or 2. */
async function legacyDatabase(version: 1 | 2) {
  const sqlite = memorySqlite();
  for (const statement of VERSION_1_SCHEMA) sqlite.exec(statement);
  sqlite.exec("PRAGMA user_version = 1");
  sqlite.exec(`
    INSERT INTO tracks (key, artist, title, duration, created_at, updated_at) VALUES
      ('a', 'A', 'T', 1, 1, 1), ('b', '', '', 1, 1, 1), ('c', '', '', 1, 1, 1);
    INSERT INTO boards (id, name, position, created_at, updated_at) VALUES
      ('warm', 'Warm-up', 1, 1, 1), ('peak', 'Peak', 0, 1, 1);
    INSERT INTO board_nodes (board_id, track_key, x, y, created_at, updated_at) VALUES
      ('peak', 'a', 100, 50, 1, 2), ('peak', 'b', 300, 80, 1, 2),
      ('warm', 'a', -20, 10, 1, 2), ('warm', 'c', 80, 30, 2, 2);
    INSERT INTO tombstones (kind, id, deleted_at) VALUES
      ('board', 'x', 1), ('board_node', 'x', 1), ('link', 'l', 1);
    INSERT INTO settings (key, value, updated_at) VALUES ('local.x', '1', 1), ('shared', '"s"', 1);
  `);
  if (version === 2) {
    // Upgrade like the app before Drizzle did.
    await openDatabase(createNodeSqliteClient(sqlite), { legacyBackup: async () => undefined });
    sqlite.exec(`DROP TABLE ${MIGRATIONS_TABLE}`);
  }
  return sqlite;
}

const tables = (sqlite: ReturnType<typeof memorySqlite>) =>
  sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => row.name);

const tracked = (sqlite: ReturnType<typeof memorySqlite>) =>
  sqlite.prepare(`SELECT idx, tag FROM ${MIGRATIONS_TABLE} ORDER BY idx`).all();

describe("legacy databases", () => {
  it("creates a new database through the migrations", async () => {
    const sqlite = memorySqlite();
    const backup = vi.fn<LegacyBackup>();
    await openDatabase(createNodeSqliteClient(sqlite), { legacyBackup: backup });
    expect(tables(sqlite)).toEqual([
      MIGRATIONS_TABLE,
      "links",
      "manual_matches",
      "nodes",
      "settings",
      "tombstones",
      "tracks",
    ]);
    expect(backup).not.toHaveBeenCalled();
  });

  it("adopts a version-2 database as migration 0000_init without touching its data", async () => {
    const sqlite = await legacyDatabase(2);
    const before = sqlite.prepare("SELECT * FROM nodes ORDER BY track_key").all();
    const backup = vi.fn<LegacyBackup>();
    const { applied } = await openDatabase(createNodeSqliteClient(sqlite), {
      legacyBackup: backup,
    });
    expect(backup).not.toHaveBeenCalled();
    expect(tracked(sqlite)).toEqual([{ idx: 0, tag: INIT_MIGRATION }]);
    // Migrations after 0000_init (if any) ran; 0000_init itself did not.
    const all = await loadMigrations();
    expect(applied).toEqual(all.slice(1).map((m) => m.tag));
    expect(sqlite.prepare("SELECT * FROM nodes ORDER BY track_key").all()).toEqual(before);

    // Opening again changes nothing.
    await openDatabase(createNodeSqliteClient(sqlite));
    expect(tracked(sqlite)).toHaveLength(all.length);
  });

  it("backs up a version-1 database (with its boards), then merges the boards", async () => {
    const sqlite = await legacyDatabase(1);
    const backup = vi.fn<LegacyBackup>(async () => undefined);
    await openDatabase(createNodeSqliteClient(sqlite), { legacyBackup: backup });

    expect(backup).toHaveBeenCalledTimes(1);
    const snapshot = backup.mock.calls[0]?.[0];
    expect(snapshot).toMatchObject({
      boards: [{ id: "peak", name: "Peak" }, { id: "warm" }],
      settings: [{ key: "shared", value: "s" }],
      version: 1,
    });
    // The backup is a valid file for this app too.
    expect(checkExport(snapshot).nodes).toHaveLength(3);

    expect(sqlite.prepare("SELECT track_key, x, y FROM nodes ORDER BY track_key").all()).toEqual([
      { track_key: "a", x: 0, y: 0 },
      { track_key: "b", x: 200, y: 30 },
      { track_key: "c", x: 700, y: 20 },
    ]);
    expect(sqlite.prepare("SELECT kind FROM tombstones").all()).toEqual([{ kind: "link" }]);
    expect(tables(sqlite)).not.toContain("boards");
    expect(sqlite.prepare("PRAGMA user_version").get()).toEqual({
      user_version: LEGACY_SCHEMA_VERSION,
    });
    expect(tracked(sqlite)[0]).toEqual({ idx: 0, tag: INIT_MIGRATION });
  });

  it("does not upgrade a version-1 database when the backup fails", async () => {
    const sqlite = await legacyDatabase(1);
    await expect(
      openDatabase(createNodeSqliteClient(sqlite), {
        legacyBackup: () => Promise.reject(new Error("disk full")),
      }),
    ).rejects.toThrow("disk full");
    expect(sqlite.prepare("PRAGMA user_version").get()).toEqual({ user_version: 1 });
    expect(tables(sqlite)).toContain("boards");
    expect(tables(sqlite)).not.toContain(MIGRATIONS_TABLE);
  });

  it("refuses a database from a newer app", async () => {
    const sqlite = memorySqlite();
    sqlite.exec(`PRAGMA user_version = ${LEGACY_SCHEMA_VERSION + 1}`);
    await expect(openDatabase(createNodeSqliteClient(sqlite))).rejects.toThrow(
      "newer than this app",
    );
  });

  it("tolerates two windows opening the same database at once", async () => {
    const sqlite = await legacyDatabase(2);
    const client = createNodeSqliteClient(sqlite);
    const lockName = `mixmap-test-${Math.random()}`;
    await Promise.all([openDatabase(client, { lockName }), openDatabase(client, { lockName })]);
    expect(tracked(sqlite)[0]).toEqual({ idx: 0, tag: INIT_MIGRATION });
  });
});
