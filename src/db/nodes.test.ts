import { beforeEach, describe, expect, it } from "vitest";
import { portableKey } from "../domain/matching";
import { addNode, listNodes, moveNodes, removeNode, restoreNode } from "./nodes";
import { createLink, listLinks } from "./links";
import { testDb, track } from "./testing";

describe("graph nodes", () => {
  let db: Awaited<ReturnType<typeof testDb>>;
  const a = track("rb1", "ATB", "Ecstasy");
  const b = track("rb2", "Caru", "San Andreas");
  const c = track("rb3", "Estelle", "American Boy");
  const [ka, kb, kc] = [a, b, c].map(portableKey);

  beforeEach(async () => {
    db = await testDb();
  });

  it("places tracks with positions", async () => {
    await addNode(db, a, 10, 20);
    await addNode(db, a, 99, 99); // already there: stays put
    await addNode(db, b, 30, 40);
    await moveNodes(db, [{ trackKey: kb, x: 300, y: 400 }]);
    expect(await listNodes(db)).toEqual([
      { trackKey: ka, x: 10, y: 20 },
      { trackKey: kb, x: 300, y: 400 },
    ]);
  });

  it("writes tombstones only for rows that existed", async () => {
    await removeNode(db, kc); // never on the graph
    expect(await db.query("SELECT * FROM tombstones")).toEqual([]);
    await addNode(db, a, 0, 0);
    await removeNode(db, ka);
    expect(await db.query("SELECT kind, id FROM tombstones")).toEqual([{ id: ka, kind: "node" }]);
    await addNode(db, a, 0, 0); // re-added: tombstone cleared
    expect(await db.query("SELECT * FROM tombstones")).toEqual([]);
  });

  it("removing a node keeps its links", async () => {
    await createLink(db, a, b);
    await addNode(db, a, 0, 0);
    await addNode(db, b, 0, 0);
    await removeNode(db, kb);
    expect(await listLinks(db)).toHaveLength(1);
  });

  it("restores a removed node where it was", async () => {
    await addNode(db, a, 12, 34);
    const [node] = await listNodes(db);
    await removeNode(db, ka);
    expect(await restoreNode(db, node)).toBe(true);
    expect(await listNodes(db)).toEqual([node]);
    expect(await db.query("SELECT * FROM tombstones")).toEqual([]);
    expect(await restoreNode(db, { trackKey: "gone", x: 0, y: 0 })).toBe(false); // track gone
  });
});
