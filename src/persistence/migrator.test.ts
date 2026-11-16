import { describe, expect, it } from "vitest";

import { createNodeSqliteClient, memorySqlite } from "@/persistence/__tests__/node-sqlite-client";
import { loadMigrations, parseMigrations } from "./bundled-migrations";
import { SqlConnection } from "./connection";
import { MIGRATIONS_TABLE, migrate } from "./migrator";

const NOW = new Date("2025-03-07T12:00:00.000Z");
const now = () => NOW;

function setup() {
  const sqlite = memorySqlite();
  const connection = new SqlConnection(createNodeSqliteClient(sqlite));
  const tracking = () => sqlite.prepare(`SELECT * FROM ${MIGRATIONS_TABLE} ORDER BY idx`).all();
  const tables = () =>
    sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((row) => row.name);
  const foreignKeys = () =>
    (sqlite.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys;
  return { connection, foreignKeys, sqlite, tables, tracking };
}

/** Migrations from `[tag, sql]` pairs, statements separated like drizzle-kit does. */
function migrations(...files: [tag: string, sql: string][]) {
  const byTag = new Map(files);
  return parseMigrations({ entries: files.map(([tag], idx) => ({ idx, tag })) }, (tag) =>
    byTag.get(tag),
  );
}

/** Connection whose `PRAGMA foreign_keys = ON` fails. */
function failingPragma() {
  const sqlite = memorySqlite();
  const client = createNodeSqliteClient(sqlite);
  const connection = new SqlConnection({
    ...client,
    execute: async (sql, params) => {
      if (/^PRAGMA foreign_keys = ON$/.test(sql)) throw new Error("pragma failed");
      return client.execute(sql, params);
    },
  });
  return { connection, sqlite };
}

const A: [string, string] = ["0000_a", "CREATE TABLE a (id INTEGER PRIMARY KEY);"];
const B: [string, string] = ["0001_b", "CREATE TABLE b (id INTEGER PRIMARY KEY);"];

describe("migrate", () => {
  it("applies the bundled migrations to a fresh database and records them", async () => {
    const { connection, tables, tracking } = setup();
    const bundled = await loadMigrations();

    await expect(migrate(connection, bundled, { now })).resolves.toEqual({
      applied: bundled.map((migration) => migration.tag),
    });
    expect(tables()).toEqual(
      expect.arrayContaining([MIGRATIONS_TABLE, "links", "nodes", "settings", "tracks"]),
    );
    expect(tracking()).toEqual(
      bundled.map((migration, idx) => ({
        idx,
        tag: migration.tag,
        hash: migration.hash,
        applied_at: NOW.toISOString(),
      })),
    );
  });

  it("applies nothing on the second run", async () => {
    const { connection, tracking } = setup();
    const bundled = await loadMigrations();
    await migrate(connection, bundled, { now });
    const before = tracking();

    await expect(
      migrate(connection, bundled, { now: () => new Date("2026-01-01T00:00:00.000Z") }),
    ).resolves.toEqual({
      applied: [],
    });
    expect(tracking()).toEqual(before);
  });

  it("applies only migrations added since the last run", async () => {
    const { connection, tables, tracking } = setup();
    await migrate(connection, await migrations(A), { now });

    await expect(migrate(connection, await migrations(A, B), { now })).resolves.toEqual({
      applied: ["0001_b"],
    });
    expect(tables()).toEqual([MIGRATIONS_TABLE, "a", "b"]);
    expect(tracking()).toMatchObject([{ tag: "0000_a" }, { tag: "0001_b", idx: 1 }]);
  });

  it("runs all statements of a migration", async () => {
    const { connection, tables } = setup();
    const sql =
      "CREATE TABLE a (id INTEGER);\n--> statement-breakpoint\nCREATE TABLE b (id INTEGER);";
    await migrate(connection, await migrations(["0000_ab", sql]), { now });
    expect(tables()).toEqual([MIGRATIONS_TABLE, "a", "b"]);
  });

  it("refuses an applied migration whose SQL changed", async () => {
    const { connection, tables } = setup();
    await migrate(connection, await migrations(A), { now });
    const edited: [string, string] = ["0000_a", "CREATE TABLE a (id INTEGER PRIMARY KEY, x);"];

    await expect(migrate(connection, await migrations(edited, B), { now })).rejects.toMatchObject({
      name: "MigrationError",
      code: "hash_mismatch",
    });
    expect(tables()).toEqual([MIGRATIONS_TABLE, "a"]);
  });

  it("refuses a database with migrations the app does not know", async () => {
    const { connection } = setup();
    await migrate(connection, await migrations(A, B), { now });

    await expect(migrate(connection, await migrations(A), { now })).rejects.toMatchObject({
      code: "unknown_migration",
    });
  });

  it("refuses applied migrations that are not the first bundled ones", async () => {
    const { connection } = setup();
    await migrate(connection, await migrations(B), { now });

    await expect(migrate(connection, await migrations(A, B), { now })).rejects.toMatchObject({
      code: "order_mismatch",
    });
  });

  it("rolls back all pending migrations if one fails", async () => {
    const { connection, foreignKeys, tables, tracking } = setup();
    const broken: [string, string] = [
      "0001_broken",
      "CREATE TABLE c (id INTEGER);\n--> statement-breakpoint\nNOT SQL",
    ];

    await expect(migrate(connection, await migrations(A, broken), { now })).rejects.toThrow(
      /syntax error/,
    );
    // The tracking table is created inside the transaction, too.
    expect(tables()).toEqual([]);
    expect(foreignKeys()).toBe(1);
    // Still usable, e.g. after the migration was fixed.
    await migrate(connection, await migrations(A), { now });
    expect(tracking()).toMatchObject([{ tag: "0000_a" }]);
  });

  describe("when re-enabling foreign keys fails", () => {
    it("still reports the error that made the migration fail", async () => {
      const { connection, sqlite } = failingPragma();
      const broken: [string, string] = ["0000_broken", "NOT SQL"];

      await expect(migrate(connection, await migrations(broken), { now })).rejects.toThrow(
        /syntax error/,
      );
      expect(sqlite.prepare("SELECT name FROM sqlite_master").all()).toEqual([]);
    });

    it("reports that error after a successful migration", async () => {
      const { connection } = failingPragma();
      await expect(migrate(connection, await migrations(A), { now })).rejects.toThrow(
        "pragma failed",
      );
    });
  });

  it("rolls back on foreign key violations", async () => {
    const { connection, foreignKeys, tables } = setup();
    const violating: [string, string] = [
      "0000_violating",
      [
        "CREATE TABLE parent (id INTEGER PRIMARY KEY);",
        "CREATE TABLE child (parent_id INTEGER NOT NULL REFERENCES parent(id));",
        "INSERT INTO child VALUES (42);",
      ].join("\n--> statement-breakpoint\n"),
    ];

    await expect(migrate(connection, await migrations(violating), { now })).rejects.toMatchObject({
      code: "foreign_key_violation",
    });
    expect(tables()).toEqual([]);
    expect(foreignKeys()).toBe(1);
  });

  it("can rebuild a referenced table (foreign keys off around the transaction)", async () => {
    const { connection, foreignKeys, sqlite } = setup();
    const init: [string, string] = [
      "0000_init",
      [
        "CREATE TABLE parent (id INTEGER PRIMARY KEY);",
        "CREATE TABLE child (parent_id INTEGER NOT NULL REFERENCES parent(id) ON DELETE RESTRICT);",
        "INSERT INTO parent VALUES (1);",
        "INSERT INTO child VALUES (1);",
      ].join("\n--> statement-breakpoint\n"),
    ];
    // What drizzle-kit generates when it cannot ALTER a table.
    const rebuild: [string, string] = [
      "0001_rebuild",
      [
        "PRAGMA foreign_keys=OFF;",
        "CREATE TABLE __new_parent (id INTEGER PRIMARY KEY, name TEXT);",
        "INSERT INTO __new_parent (id) SELECT id FROM parent;",
        "DROP TABLE parent;",
        "ALTER TABLE __new_parent RENAME TO parent;",
        "PRAGMA foreign_keys=ON;",
      ].join("\n--> statement-breakpoint\n"),
    ];
    await migrate(connection, await migrations(init), { now });

    await expect(migrate(connection, await migrations(init, rebuild), { now })).resolves.toEqual({
      applied: ["0001_rebuild"],
    });
    expect(sqlite.prepare("SELECT * FROM parent").all()).toEqual([{ id: 1, name: null }]);
    expect(sqlite.prepare("SELECT * FROM child").all()).toEqual([{ parent_id: 1 }]);
    expect(foreignKeys()).toBe(1);
  });

  it("would fail to rebuild a referenced table with foreign keys on", () => {
    // Counter-check for the test above: inside a transaction SQLite ignores
    // `PRAGMA foreign_keys=OFF`, so DROP TABLE hits the RESTRICT.
    const sqlite = memorySqlite();
    sqlite.exec(`
      CREATE TABLE parent (id INTEGER PRIMARY KEY);
      CREATE TABLE child (parent_id INTEGER NOT NULL REFERENCES parent(id) ON DELETE RESTRICT);
      INSERT INTO parent VALUES (1);
      INSERT INTO child VALUES (1);
    `);
    sqlite.exec("BEGIN; PRAGMA foreign_keys=OFF;");
    expect(() => sqlite.exec("DROP TABLE parent")).toThrow(/FOREIGN KEY/);
  });
});
