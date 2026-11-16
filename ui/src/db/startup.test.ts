import { describe, expect, it, vi } from "vitest";
import type { LibrarySource } from "../api";
import { setSetting, SETTINGS } from "./settings";
import { checkExport } from "./exchange";
import { migrate, MIGRATIONS, schemaVersion } from "./schema";
import { type BackupWriter, startDatabase } from "./startup";
import { memoryDb } from "./testing";

describe("startDatabase", () => {
  it("migrates and leaves the automatic source alone", async () => {
    const db = memoryDb();
    const apply = vi.fn<(s: LibrarySource) => Promise<unknown>>(async () => undefined);
    await startDatabase(db, apply);
    expect(apply).not.toHaveBeenCalled();
    await setSetting(db, SETTINGS.librarySource, { kind: "auto" });
    await startDatabase(db, apply);
    expect(apply).not.toHaveBeenCalled();
  });

  it("backs up a version 1 database (with its boards) before merging boards", async () => {
    const db = memoryDb();
    for (const sql of MIGRATIONS[0]) db.raw.exec(sql);
    db.raw.exec(`
      PRAGMA user_version = 1;
      INSERT INTO tracks (key, artist, title, duration, created_at, updated_at) VALUES ('a', 'A', 'T', 1, 1, 1);
      INSERT INTO boards (id, name, position, created_at, updated_at) VALUES ('B', 'Peak', 0, 1, 1);
      INSERT INTO board_nodes (board_id, track_key, x, y, created_at, updated_at) VALUES ('B', 'a', 5, 6, 1, 1);
    `);
    const backup = vi.fn<BackupWriter>(async () => undefined);
    const apply = vi.fn<(s: LibrarySource) => Promise<unknown>>(async () => undefined);
    await startDatabase(db, apply, backup);
    expect(backup).toHaveBeenCalledTimes(1);
    const [content, reason] = backup.mock.calls[0];
    expect(reason).toBe("before-upgrade");
    const file = JSON.parse(content);
    expect(file).toMatchObject({ boards: [{ id: "B", name: "Peak" }], version: 1 });
    // The backup is a valid file for this app too.
    expect(checkExport(file).nodes).toEqual([{ createdAt: 1, trackKey: "a", updatedAt: 1, x: 0, y: 0 }]);
    expect(await schemaVersion(db)).toBe(MIGRATIONS.length);

    // Already migrated, or a new database: no backup.
    await startDatabase(db, apply, backup);
    await startDatabase(memoryDb(), apply, backup);
    expect(backup).toHaveBeenCalledTimes(1);
  });

  it("does not migrate when the backup fails", async () => {
    const db = memoryDb();
    for (const sql of MIGRATIONS[0]) db.raw.exec(sql);
    db.raw.exec("PRAGMA user_version = 1");
    const apply = vi.fn<(s: LibrarySource) => Promise<unknown>>(async () => undefined);
    await expect(startDatabase(db, apply, () => Promise.reject(new Error("disk full")))).rejects.toThrow("disk full");
    expect(await schemaVersion(db)).toBe(1);
  });

  it("re-applies a saved source", async () => {
    const db = memoryDb();
    await migrate(db);
    const source: LibrarySource = { kind: "xml", path: "C:\\x.xml" };
    await setSetting(db, SETTINGS.librarySource, source);
    const apply = vi.fn<(s: LibrarySource) => Promise<unknown>>(async () => undefined);
    await startDatabase(db, apply);
    expect(apply).toHaveBeenCalledWith(source);
  });
});
