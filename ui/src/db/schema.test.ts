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
    expect(tables.map((t) => t.name)).toEqual([
      "board_nodes",
      "boards",
      "links",
      "manual_matches",
      "settings",
      "tombstones",
      "tracks",
    ]);
    const [{ user_version }] = await db.query<{ user_version: number }>("PRAGMA user_version");
    expect(user_version).toBe(MIGRATIONS.length);
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
