import { describe, expect, it } from "vitest";
import { now } from "./db";
import { migrate, MIGRATIONS, tombstoneId } from "./schema";
import { getSetting, setSetting } from "./settings";
import { memoryDb } from "./testing";

describe("schema", () => {
  it("migrates an empty database and is idempotent", async () => {
    const db = memoryDb();
    expect(await migrate(db)).toBe(MIGRATIONS.length);
    expect(await migrate(db)).toBe(MIGRATIONS.length);
    const tables = await db.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    );
    expect(tables.map((t) => t.name)).toEqual(["links", "manual_matches", "nodes", "settings", "tombstones", "tracks"]);
    const [{ user_version }] = await db.query<{ user_version: number }>("PRAGMA user_version");
    expect(user_version).toBe(MIGRATIONS.length);
  });

  it("merges boards into one graph (migration 2)", async () => {
    const db = memoryDb();
    // A version 1 database with two boards; track a is on both.
    for (const sql of MIGRATIONS[0]) db.raw.exec(sql);
    db.raw.exec("PRAGMA user_version = 1");
    db.raw.exec(`
      INSERT INTO tracks (key, artist, title, duration, created_at, updated_at) VALUES
        ('a', '', '', 1, 1, 1), ('b', '', '', 1, 1, 1), ('c', '', '', 1, 1, 1);
      INSERT INTO boards (id, name, position, created_at, updated_at) VALUES
        ('warm', 'Warm-up', 1, 1, 1), ('peak', 'Peak', 0, 1, 1);
      INSERT INTO board_nodes (board_id, track_key, x, y, created_at, updated_at) VALUES
        ('peak', 'a', 100, 50, 1, 2), ('peak', 'b', 300, 80, 1, 2),
        ('warm', 'a', -20, 10, 1, 2), ('warm', 'c', 80, 30, 2, 2);
      INSERT INTO tombstones (kind, id, deleted_at) VALUES ('board', 'x', 1), ('board_node', 'x', 1), ('link', 'l', 1);
    `);
    expect(await migrate(db)).toBe(MIGRATIONS.length);
    expect(await db.query("SELECT track_key, x, y FROM nodes ORDER BY track_key")).toEqual([
      { track_key: "a", x: 0, y: 0 },
      { track_key: "b", x: 200, y: 30 },
      { track_key: "c", x: 700, y: 20 },
    ]);
    expect(await db.query("SELECT kind FROM tombstones")).toEqual([{ kind: "link" }]);
  });

  it("tolerates concurrent migrations", async () => {
    const db = memoryDb();
    // Interleave like two windows: both read version 0 before either migrates.
    const query = db.query.bind(db);
    let reads = 0;
    let release!: () => void;
    const bothRead = new Promise<void>((r) => (release = r));
    db.query = async <T>(sql: string, params?: never[]) => {
      const rows = await query<T>(sql, params);
      if (sql === "PRAGMA user_version" && ++reads === 2) release();
      if (sql === "PRAGMA user_version" && reads <= 2) await bothRead;
      return rows;
    };
    await expect(Promise.all([migrate(db), migrate(db)])).resolves.toEqual([MIGRATIONS.length, MIGRATIONS.length]);
  });

  it("refuses a database from a newer app", async () => {
    const db = memoryDb();
    db.raw.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
    await expect(migrate(db)).rejects.toThrow("newer than this app");
  });

  it("enforces link rules", async () => {
    const db = memoryDb();
    await migrate(db);
    const t = now();
    const track = (key: string) => ({
      params: [key, "A", key, 300, t, t],
      sql: "INSERT INTO tracks (key, artist, title, duration, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    });
    const link = (from: string, to: string, rating: number | null = null) => ({
      params: [from, to, rating, t, t],
      sql: "INSERT INTO links (from_track, to_track, rating, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    });
    await db.execute([track("a"), track("b"), track("c"), link("a", "b", 5), link("b", "a")]);
    await expect(db.execute([link("a", "b")])).rejects.toThrow("UNIQUE"); // one per direction
    await expect(db.execute([link("a", "a")])).rejects.toThrow("CHECK"); // no self links
    await expect(db.execute([link("a", "nope")])).rejects.toThrow("FOREIGN KEY"); // FK
    await expect(db.execute([link("c", "a", 6)])).rejects.toThrow("CHECK"); // rating 1–5
    await expect(db.execute([track("a")])).rejects.toThrow("UNIQUE"); // one row per portable key
    const [{ n }] = await db.query<{ n: number }>("SELECT count(*) AS n FROM links");
    expect(n).toBe(2);
  });

  it("builds tombstone ids from natural keys", () => {
    expect(tombstoneId("atb|ecstasy|353")).toBe("atb|ecstasy|353");
    expect(tombstoneId("a|b|1", "c|d|2")).toBe("a|b|1\u0001c|d|2");
  });

  it("stores settings as JSON", async () => {
    const db = memoryDb();
    await migrate(db);
    expect(await getSetting(db, "x")).toBeUndefined();
    await setSetting(db, "x", { kind: "xml", path: "C:\\a.xml" });
    await setSetting(db, "x", { kind: "auto" });
    expect(await getSetting(db, "x")).toEqual({ kind: "auto" });
  });
});
