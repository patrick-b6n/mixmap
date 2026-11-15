import { beforeEach, describe, expect, it } from "vitest";
import { portableKey } from "../domain/matching";
import { addNode, createBoard, removeNode } from "./boards";
import { exportData, exportFileName, serializeExport } from "./exchange";
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
    const board = await createBoard(db, "Peak");
    await addNode(db, board.id, a, 10, 20);
    await addNode(db, board.id, c, 30, 40);
    await removeNode(db, board.id, kc);
    await setManualMatch(db, kc, "rb3");
    await setSetting(db, "local.library.source", { kind: "auto" });
    await setSetting(db, "graph.theme", "dark");

    const data = await exportData(db, new Map([["rb3", c]]), 123);
    expect(data).toMatchObject({ exportedAt: 123, format: "mixmap", version: 1 });
    expect(data.tracks.map((t) => t.key).toSorted()).toEqual([ka, kb, kc].toSorted());
    expect(data.tracks[0]).not.toHaveProperty("rekordboxId");
    expect(data.links).toEqual([
      expect.objectContaining({ comment: "long blend", from: ka, rating: 4, tags: ["peak"], to: kb }),
    ]);
    expect(data.boards).toEqual([expect.objectContaining({ id: board.id, name: "Peak" })]);
    expect(data.boardNodes).toEqual([expect.objectContaining({ boardId: board.id, trackKey: ka, x: 10, y: 20 })]);
    expect(data.manualMatches).toEqual([expect.objectContaining({ rekordboxId: "rb3", targetKey: kc, trackKey: kc })]);
    expect(data.tombstones.map((t) => [t.kind, t.id]).toSorted()).toEqual(
      [
        ["board_node", tombstoneId(board.id, kc)],
        ["link", tombstoneId(kb, kc)],
      ].toSorted(),
    );
    // Machine-local settings never leave the machine.
    expect(data.settings).toEqual([expect.objectContaining({ key: "graph.theme", value: "dark" })]);
    for (const row of [...data.tracks, ...data.links, ...data.boards, ...data.boardNodes]) {
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
