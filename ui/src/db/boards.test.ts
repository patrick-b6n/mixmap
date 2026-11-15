import { beforeEach, describe, expect, it } from "vitest";
import { portableKey } from "../domain/matching";
import {
  addNode,
  createBoard,
  deleteBoard,
  listBoards,
  listNodes,
  loadBoard,
  moveNodes,
  removeNode,
  renameBoard,
} from "./boards";
import { createLink, listLinks } from "./links";
import { migrate, tombstoneId } from "./schema";
import { memoryDb, track } from "./testing";

describe("boards", () => {
  let db: ReturnType<typeof memoryDb>;
  const a = track("rb1", "ATB", "Ecstasy");
  const b = track("rb2", "Caru", "San Andreas");
  const c = track("rb3", "Estelle", "American Boy");
  const [ka, kb, kc] = [a, b, c].map(portableKey);

  beforeEach(async () => {
    db = memoryDb();
    await migrate(db);
  });

  it("creates, orders, renames and deletes boards", async () => {
    const peak = await createBoard(db, " Peak-time techno ");
    const warm = await createBoard(db, "Warm-up");
    expect((await listBoards(db)).map((x) => [x.name, x.position])).toEqual([
      ["Peak-time techno", 0],
      ["Warm-up", 1],
    ]);
    await renameBoard(db, warm.id, "Warm up");
    await expect(renameBoard(db, warm.id, "  ")).rejects.toThrow("empty");
    await expect(createBoard(db, "")).rejects.toThrow("empty");

    await addNode(db, peak.id, a, 0, 0);
    await deleteBoard(db, peak.id);
    expect((await listBoards(db)).map((x) => x.name)).toEqual(["Warm up"]);
    const tombs = await db.query<{ id: string; kind: string }>("SELECT kind, id FROM tombstones ORDER BY kind");
    expect(tombs).toEqual([
      { id: peak.id, kind: "board" },
      { id: tombstoneId(peak.id, ka), kind: "board_node" },
    ]);
  });

  it("places tracks with positions; a track can be on several boards", async () => {
    const one = await createBoard(db, "One");
    const two = await createBoard(db, "Two");
    await addNode(db, one.id, a, 10, 20);
    await addNode(db, one.id, a, 99, 99); // already there: stays put
    await addNode(db, one.id, b, 30, 40);
    await addNode(db, two.id, a, 5, 5);
    await moveNodes(db, one.id, [{ trackKey: kb, x: 300, y: 400 }]);
    expect(await listNodes(db, one.id)).toEqual([
      { boardId: one.id, trackKey: ka, x: 10, y: 20 },
      { boardId: one.id, trackKey: kb, x: 300, y: 400 },
    ]);
    expect((await listNodes(db, two.id)).map((n) => n.trackKey)).toEqual([ka]);
    await expect(addNode(db, "no-such-board", c, 0, 0)).rejects.toThrow("FOREIGN KEY");
  });

  it("writes tombstones only for rows that existed", async () => {
    const one = await createBoard(db, "One");
    await removeNode(db, one.id, kc); // never on the board
    await deleteBoard(db, "no-such-board");
    expect(await db.query("SELECT * FROM tombstones")).toEqual([]);
    await addNode(db, one.id, a, 0, 0);
    await removeNode(db, one.id, ka);
    await addNode(db, one.id, a, 0, 0); // re-added: tombstone cleared
    expect(await db.query("SELECT * FROM tombstones")).toEqual([]);
  });

  it("shows a link on every board that contains both endpoints", async () => {
    const one = await createBoard(db, "One");
    const two = await createBoard(db, "Two");
    await createLink(db, a, b);
    await createLink(db, b, c);
    for (const t of [a, b, c]) await addNode(db, one.id, t, 0, 0);
    await addNode(db, two.id, a, 0, 0);
    await addNode(db, two.id, b, 0, 0);
    expect((await loadBoard(db, one.id)).links.map((l) => [l.from, l.to])).toEqual([
      [ka, kb],
      [kb, kc],
    ]);
    expect((await loadBoard(db, two.id)).links.map((l) => [l.from, l.to])).toEqual([[ka, kb]]);

    // Removing from a board keeps the (global) links.
    await removeNode(db, two.id, kb);
    expect((await loadBoard(db, two.id)).links).toEqual([]);
    expect(await listLinks(db)).toHaveLength(2);
  });
});
