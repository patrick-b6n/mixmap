import { beforeEach, describe, expect, it } from "vitest";
import { portableKey } from "../domain/matching";
import { cleanTags, createLink, deleteLink, listLinks, restoreLinks, updateLink } from "./links";
import { migrate, tombstoneId } from "./schema";
import { memoryDb, track } from "./testing";

describe("links", () => {
  let db: ReturnType<typeof memoryDb>;
  const a = track("rb1", "ATB", "Ecstasy");
  const b = track("rb2", "Caru", "San Andreas");
  const ka = portableKey(a);
  const kb = portableKey(b);

  beforeEach(async () => {
    db = memoryDb();
    await migrate(db);
  });

  const tombstones = () => db.query<{ id: string; kind: string }>("SELECT kind, id FROM tombstones");

  it("creates directed links, one per direction, adding the tracks", async () => {
    const l = await createLink(db, a, b, { comment: "nice", rating: 4, tags: [" peak ", "Peak", ""] });
    expect(l).toMatchObject({ comment: "nice", from: ka, rating: 4, tags: ["peak"], to: kb });
    // Same direction again: unchanged; the other direction is a separate link.
    await createLink(db, a, b, { comment: "ignored" });
    await createLink(db, b, a);
    const links = await listLinks(db);
    expect(links.map((x) => [x.from, x.to, x.comment])).toEqual([
      [ka, kb, "nice"],
      [kb, ka, ""],
    ]);
    const [{ n }] = await db.query<{ n: number }>("SELECT count(*) AS n FROM tracks");
    expect(n).toBe(2);
  });

  it("rejects self links and invalid ratings", async () => {
    await expect(createLink(db, a, a)).rejects.toThrow("itself");
    await expect(createLink(db, a, b, { rating: 6 })).rejects.toThrow("1–5");
    await createLink(db, a, b);
    await expect(updateLink(db, ka, kb, { rating: 0 })).rejects.toThrow("1–5");
  });

  it("updates comment, rating and tags", async () => {
    const created = await createLink(db, a, b);
    const l = await updateLink(db, ka, kb, { comment: "long blend", rating: 5, tags: ["warm-up"] });
    expect(l).toMatchObject({ comment: "long blend", rating: 5, tags: ["warm-up"] });
    expect(l.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
    expect((await updateLink(db, ka, kb, { rating: null })).rating).toBeNull();
    await expect(updateLink(db, kb, ka, { comment: "x" })).rejects.toThrow("not found");
  });

  it("deletes with a tombstone and restores exactly on undo", async () => {
    const created = await createLink(db, a, b, { comment: "keep me", rating: 3, tags: ["x"] });
    const deleted = await deleteLink(db, ka, kb);
    expect(deleted).toEqual(created);
    expect(await listLinks(db)).toEqual([]);
    expect(await tombstones()).toEqual([{ id: tombstoneId(ka, kb), kind: "link" }]);

    await restoreLinks(db, [deleted!]);
    const [restored] = await listLinks(db);
    expect(restored).toMatchObject({ comment: "keep me", createdAt: created.createdAt, rating: 3, tags: ["x"] });
    expect(await tombstones()).toEqual([]);
    expect(await deleteLink(db, kb, ka)).toBeUndefined();
  });

  it("keeps tombstones of existing links and skips restores without tracks", async () => {
    await createLink(db, a, b);
    // e.g. a stale tombstone from a sync merge: re-"creating" the link keeps it.
    await db.execute([
      { params: [tombstoneId(ka, kb), 1], sql: "INSERT INTO tombstones (kind, id, deleted_at) VALUES ('link', ?, ?)" },
    ]);
    await createLink(db, a, b);
    expect(await tombstones()).toHaveLength(1);

    const gone = { ...(await listLinks(db))[0], from: "gone|track|1" };
    await restoreLinks(db, [gone]);
    expect(await listLinks(db)).toHaveLength(1);
  });

  it("cleans tags", () => {
    expect(cleanTags(["a", " A ", "b", "  ", 7])).toEqual(["a", "b"]);
  });
});
