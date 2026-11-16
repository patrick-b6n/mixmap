import { beforeEach, describe, expect, it } from "vitest";
import { portableKey } from "../domain/matching";
import { addNode, removeNode } from "./nodes";
import { checkExport, exportData, exportFileName, nodesFromBoards, serializeExport } from "./exchange";
import { createLink, deleteLink } from "./links";
import { migrate, tombstoneId } from "./schema";
import { setSetting } from "./settings";
import { memoryDb, track } from "./testing";
import { setManualMatch } from "./tracks";

describe("export", () => {
  let db: ReturnType<typeof memoryDb>;
  const a = track("rb1", "ATB", "Ecstasy");
  const b = track("rb2", "Caru", "San Andreas");
  const c = track("rb3", "Cloonee", "X-Rated");
  const [ka, kb, kc] = [a, b, c].map(portableKey);

  beforeEach(async () => {
    db = memoryDb();
    await migrate(db);
  });

  it("exports everything that syncs, keyed by portable track key", async () => {
    await createLink(db, a, b, { comment: "long blend", rating: 4, tags: ["peak"] });
    await createLink(db, b, c);
    await deleteLink(db, kb, kc);
    await addNode(db, a, 10, 20);
    await addNode(db, c, 30, 40);
    await removeNode(db, kc);
    await setManualMatch(db, kc, "rb3");
    await setSetting(db, "local.library.source", { kind: "auto" });
    await setSetting(db, "graph.theme", "dark");

    const data = await exportData(db, new Map([["rb3", c]]), 123);
    expect(data).toMatchObject({ exportedAt: 123, format: "mixmap", version: 2 });
    expect(data.tracks.map((t) => t.key).toSorted()).toEqual([ka, kb, kc].toSorted());
    expect(data.tracks[0]).not.toHaveProperty("rekordboxId");
    expect(data.links).toEqual([
      expect.objectContaining({ comment: "long blend", from: ka, rating: 4, tags: ["peak"], to: kb }),
    ]);
    expect(data.nodes).toEqual([expect.objectContaining({ trackKey: ka, x: 10, y: 20 })]);
    expect(data.manualMatches).toEqual([expect.objectContaining({ rekordboxId: "rb3", targetKey: kc, trackKey: kc })]);
    expect(data.tombstones.map((t) => [t.kind, t.id]).toSorted()).toEqual(
      [
        ["node", tombstoneId(kc)],
        ["link", tombstoneId(kb, kc)],
      ].toSorted(),
    );
    // Machine-local settings never leave the machine.
    expect(data.settings).toEqual([expect.objectContaining({ key: "graph.theme", value: "dark" })]);
    for (const row of [...data.tracks, ...data.links, ...data.nodes]) {
      expect(row.createdAt).toBeGreaterThan(0);
      expect(row.updatedAt).toBeGreaterThanOrEqual(row.createdAt);
    }
  });

  it("round-trips through JSON", async () => {
    await createLink(db, a, b);
    const data = await exportData(db);
    expect(JSON.parse(serializeExport(data))).toEqual(data);
  });

  it("names files with a sortable local timestamp", () => {
    expect(exportFileName(new Date(2026, 0, 5, 9, 3, 7))).toBe("mixmap-2026-01-05-090307.mixmap.json");
  });
});

/** A version 1 board node. */
const n = (boardId: string, trackKey: string, x: number, y: number, createdAt = 1) => ({
  boardId,
  createdAt,
  trackKey,
  updatedAt: 2,
  x,
  y,
});

describe("version 1 files (boards)", () => {
  it("lays boards side by side in tab order; the first board wins a shared track", () => {
    const boards = [
      { createdAt: 1, id: "warm", position: 1 },
      { createdAt: 1, id: "peak", position: 0 },
    ];
    const nodes = nodesFromBoards(boards, [
      n("peak", "a", 100, 50),
      n("peak", "b", 300, 80),
      n("warm", "a", -20, 10),
      n("warm", "c", 80, 30, 2),
      n("gone", "d", 0, 0),
    ]);
    // peak: shifted to (0, 0), 200 wide; warm's left edge (its a) moves to 200 + gap.
    expect(nodes.map((x) => [x.trackKey, x.x, x.y])).toEqual([
      ["a", 0, 0],
      ["b", 200, 30],
      ["c", 700, 20],
    ]);
  });

  it("imports a version 1 file as one graph and drops board tombstones", () => {
    const stored = { artist: "A", createdAt: 1, duration: 1, key: "a", title: "A", updatedAt: 1 };
    const data = checkExport({
      boardNodes: [n("B", "a", 10, 20)],
      boards: [{ createdAt: 1, id: "B", name: "Peak", position: 0, updatedAt: 1 }],
      format: "mixmap",
      tombstones: [
        { deletedAt: 1, id: "X", kind: "board" },
        { deletedAt: 1, id: "a\u0001b", kind: "link" },
      ],
      tracks: [stored],
      version: 1,
    });
    expect(data.nodes).toEqual([{ createdAt: 1, trackKey: "a", updatedAt: 2, x: 0, y: 0 }]);
    expect(data.tombstones.map((t) => t.kind)).toEqual(["link"]);
    expect(data.version).toBe(2);
  });
});
