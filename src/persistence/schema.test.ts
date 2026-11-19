import { describe, expect, it } from "vitest";

import { createTestDb } from "@/persistence/__tests__/test-db";

describe("schema", () => {
  it("enforces link rules", async () => {
    const { sql: db } = await createTestDb();
    const t = Date.now();
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
    const [row] = await db.query<{ n: number }>("SELECT count(*) AS n FROM links");
    expect(row?.n).toBe(2);
  });

  it("rolls back all statements of a failed execute", async () => {
    const { sql: db } = await createTestDb();
    const insert = {
      params: ["a", "1", 1],
      sql: "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)",
    };
    await expect(db.execute([insert, { sql: "INSERT INTO nope VALUES (1)" }])).rejects.toThrow(
      "no such table",
    );
    expect(await db.query("SELECT * FROM settings")).toEqual([]);
  });
});
