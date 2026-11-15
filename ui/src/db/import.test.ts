import { beforeEach, describe, expect, it } from "vitest";
import { portableKey } from "../domain/matching";
import { addNode, createBoard, deleteBoard, listBoards, listNodes } from "./boards";
import { exportData, importData, parseExport, serializeExport } from "./exchange";
import { createLink, deleteLink, listLinks, updateLink } from "./links";
import { migrate } from "./schema";
import { getSetting, setSetting } from "./settings";
import { memoryDb, track } from "./testing";
import { listTracks, setManualMatch } from "./tracks";

const a = track("rb1", "ATB", "Ecstasy");
const b = track("rb2", "Caru", "San Andreas");
const c = track("rb3", "Cloonee", "X-Rated");
const [ka, kb, kc] = [a, b, c].map(portableKey);

async function fresh() {
  const db = memoryDb();
  await migrate(db);
  return db;
}

/** Export without the export time, for comparing two databases. */
const snapshot = async (db: Awaited<ReturnType<typeof fresh>>) => ({ ...(await exportData(db)), exportedAt: 0 });

/** Let the clock move on, so later writes get later timestamps. */
const tick = () => new Promise((r) => setTimeout(r, 3));

describe("import", () => {
  let db: Awaited<ReturnType<typeof fresh>>;
  beforeEach(async () => {
    db = await fresh();
  });

  it("merges a file into an empty database (export → import round trip)", async () => {
    await createLink(db, a, b, { comment: "blend", rating: 5, tags: ["peak"] });
    const board = await createBoard(db, "Peak");
    await addNode(db, board.id, a, 1, 2);
    const file = parseExport(serializeExport(await exportData(db)));

    const other = await fresh();
    const summary = await importData(other, file, "merge");
    expect(summary.links.added).toBe(1);
    expect(summary.boards.added).toBe(1);
    expect(await snapshot(other)).toEqual(await snapshot(db));
    // Imported tracks still need matching on this machine.
    expect((await listTracks(other)).every((t) => t.rekordboxId === null)).toBe(true);
  });

  it("two-way merge converges and propagates deletions", async () => {
    await createLink(db, a, b);
    await createLink(db, b, c);
    const other = await fresh();
    await importData(other, await exportData(db), "merge");
    await tick();
    // Each side changes something; then sync both ways.
    await deleteLink(db, ka, kb);
    await updateLink(other, kb, kc, { comment: "from other" });
    await createLink(other, c, a);
    const [x, y] = [await exportData(db), await exportData(other)];
    await importData(db, y, "merge");
    await importData(other, x, "merge");
    expect(await snapshot(db)).toEqual(await snapshot(other));
    expect((await listLinks(db)).map((l) => [l.from, l.to, l.comment])).toEqual(
      [
        [kb, kc, "from other"],
        [kc, ka, ""],
      ].toSorted((p, q) => p[0].localeCompare(q[0])),
    );
  });

  it("a deleted board disappears with its nodes on the other side", async () => {
    const board = await createBoard(db, "Warm-up");
    await addNode(db, board.id, a, 0, 0);
    const other = await fresh();
    await importData(other, await exportData(db), "merge");
    await tick();
    await deleteBoard(db, board.id);
    await importData(other, await exportData(db), "merge");
    expect(await listBoards(other)).toEqual([]);
    expect(await listNodes(other, board.id)).toEqual([]);
  });

  it("replace wipes synced data but keeps machine-local settings", async () => {
    await createLink(db, a, b);
    await setSetting(db, "local.library.source", { kind: "xml", path: "x" });
    await setSetting(db, "shared.thing", 1);
    const source = await fresh();
    await createLink(source, b, c);
    const summary = await importData(db, await exportData(source), "replace");
    expect(summary.links.added).toBe(1);
    expect((await listLinks(db)).map((l) => [l.from, l.to])).toEqual([[kb, kc]]);
    expect(await getSetting(db, "local.library.source")).toEqual({ kind: "xml", path: "x" });
    expect(await getSetting(db, "shared.thing")).toBeUndefined();
  });

  it("resolves manual matches through the portable key of their target", async () => {
    await createLink(db, a, b);
    await setManualMatch(db, ka, "rb9");
    const renamed = track("rb9", "ATB", "Ecstasy (Original Mix)");
    const file = await exportData(db, new Map([["rb9", renamed]]));
    const other = await fresh();
    // On the other machine the same audio has another id.
    await importData(other, file, "merge", new Map([["x42", renamed]]));
    expect(await other.query("SELECT track_key, rekordbox_id FROM manual_matches")).toEqual([
      { rekordbox_id: "x42", track_key: ka },
    ]);
  });
});

const t = (key: string) => ({ artist: "", createdAt: 1, duration: 1, key, title: "", updatedAt: 1 });

describe("parseExport", () => {
  const ok = { format: "mixmap", version: 1 };

  it("accepts a minimal file", () => {
    expect(parseExport(JSON.stringify(ok)).links).toEqual([]);
  });

  it("rejects other files with a readable reason", () => {
    expect(() => parseExport("not json")).toThrow(/not JSON/);
    expect(() => parseExport("{}")).toThrow(/format "mixmap"/);
    expect(() => parseExport(JSON.stringify({ ...ok, version: 2 }))).toThrow(/version 2/);
    expect(() => parseExport(JSON.stringify({ ...ok, links: {} }))).toThrow(/links must be a list/);
    const link = { createdAt: 1, from: "a", to: "b", updatedAt: 1 };
    expect(() => parseExport(JSON.stringify({ ...ok, links: [link] }))).toThrow(/has no track/);
    expect(() =>
      parseExport(JSON.stringify({ ...ok, links: [{ ...link, rating: 9 }], tracks: [t("a"), t("b")] })),
    ).toThrow(/rating/);
    expect(() => parseExport(JSON.stringify({ ...ok, tombstones: [{ deletedAt: 1, id: "x", kind: "nope" }] }))).toThrow(
      /unknown/,
    );
  });

  it("drops machine-local settings", () => {
    const file = { ...ok, settings: [{ key: "local.library.source", updatedAt: 1, value: {} }] };
    expect(parseExport(JSON.stringify(file)).settings).toEqual([]);
  });
});
