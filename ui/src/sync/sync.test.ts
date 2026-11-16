import { beforeEach, describe, expect, it } from "vitest";
import { addNode, listNodes, removeNode } from "../db/nodes";
import { exportData } from "../db/exchange";
import { createLink, deleteLink, listLinks, updateLink } from "../db/links";
import { migrate } from "../db/schema";
import { memoryDb, track } from "../db/testing";
import { portableKey } from "../domain/matching";
import { answerSync, changeCount, syncNow } from "./sync";

const a = track("rb1", "ATB", "Ecstasy");
const b = track("rb2", "Caru", "San Andreas");
const c = track("rb3", "Cloonee", "X-Rated");
const [ka, kb, kc] = [a, b, c].map(portableKey);
const tick = () => new Promise((r) => setTimeout(r, 3));

async function fresh() {
  const db = memoryDb();
  await migrate(db);
  return db;
}

describe("sync now", () => {
  let here: Awaited<ReturnType<typeof fresh>>;
  let there: Awaited<ReturnType<typeof fresh>>;
  /** The network round trip, straight into the peer's answer. */
  const exchange = (data: unknown) => answerSync(there, new Map(), JSON.parse(JSON.stringify(data)));
  const snapshot = async (db: typeof here) => ({ ...(await exportData(db)), exportedAt: 0 });

  beforeEach(async () => {
    here = await fresh();
    there = await fresh();
  });

  it("brings both sides to the same data", async () => {
    await createLink(here, a, b, { comment: "here" });
    await addNode(there, c, 1, 1);
    await createLink(there, b, c);

    const result = await syncNow(here, new Map(), exchange);
    expect(await snapshot(here)).toEqual(await snapshot(there));
    expect(result.received.links.added).toBe(1);
    expect(result.received.nodes.added).toBe(1);
    expect(result.sent?.links.added).toBe(1);
  });

  it("propagates edits and deletions both ways, newest wins", async () => {
    await createLink(here, a, b);
    await createLink(here, b, c);
    await addNode(here, a, 0, 0);
    await syncNow(here, new Map(), exchange);
    await tick();
    await updateLink(there, ka, kb, { comment: "edited there" });
    await deleteLink(here, kb, kc);
    await removeNode(there, ka);

    const result = await syncNow(here, new Map(), exchange);
    expect(await snapshot(here)).toEqual(await snapshot(there));
    expect((await listLinks(here)).map((l) => [l.from, l.to, l.comment])).toEqual([[ka, kb, "edited there"]]);
    expect(await listNodes(here)).toEqual([]);
    expect(changeCount(result.received)).toBe(2);
    expect(result.sent?.links.deleted).toBe(1);
  });

  it("a second sync changes nothing", async () => {
    await createLink(here, a, b);
    await syncNow(here, new Map(), exchange);
    const again = await syncNow(here, new Map(), exchange);
    expect(changeCount(again.received)).toBe(0);
    expect(changeCount(again.sent)).toBe(0);
  });

  it("changes nothing here when the peer sends garbage", async () => {
    await createLink(here, a, b);
    const before = await snapshot(here);
    await expect(syncNow(here, new Map(), async () => ({ data: { nope: 1 }, summary: {} }))).rejects.toThrow(/mixmap/);
    expect(await snapshot(here)).toEqual(before);
  });
});
