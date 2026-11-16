import { beforeEach, describe, expect, it } from "vitest";
import { addNode, listNodes, removeNode } from "@/persistence/repositories/nodes";
import { exportData } from "@/persistence/repositories/exchange";
import { createLink, deleteLink, listLinks, updateLink } from "@/persistence/repositories/links";
import { testDb, track } from "@/persistence/__tests__/repositories";
import { createRepositories } from "@/persistence/repositories";
import { portableKey } from "@/business/matching";
import { answerSync, changeCount, syncNow } from "@/business/sync";

const a = track("rb1", "ATB", "Ecstasy");
const b = track("rb2", "Caru", "San Andreas");
const c = track("rb3", "Cloonee", "X-Rated");
const ka = portableKey(a);
const kb = portableKey(b);
const kc = portableKey(c);
const tick = () => new Promise((r) => setTimeout(r, 3));

async function fresh() {
  const db = await testDb();
  return db;
}

describe("sync now", () => {
  let here: Awaited<ReturnType<typeof fresh>>;
  let there: Awaited<ReturnType<typeof fresh>>;
  /** The network round trip, straight into the peer's answer. */
  const exchange = (data: unknown) =>
    answerSync(createRepositories(there).exchange, new Map(), JSON.parse(JSON.stringify(data)));
  const snapshot = async (db: typeof here) => ({ ...(await exportData(db)), exportedAt: 0 });

  beforeEach(async () => {
    here = await fresh();
    there = await fresh();
  });

  it("brings both sides to the same data", async () => {
    await createLink(here, a, b, { comment: "here" });
    await addNode(there, c, 1, 1);
    await createLink(there, b, c);

    const result = await syncNow(createRepositories(here).exchange, new Map(), exchange);
    expect(await snapshot(here)).toEqual(await snapshot(there));
    expect(result.received.links.added).toBe(1);
    expect(result.received.nodes.added).toBe(1);
    expect(result.sent?.links.added).toBe(1);
  });

  it("propagates edits and deletions both ways, newest wins", async () => {
    await createLink(here, a, b);
    await createLink(here, b, c);
    await addNode(here, a, 0, 0);
    await syncNow(createRepositories(here).exchange, new Map(), exchange);
    await tick();
    await updateLink(there, ka, kb, { comment: "edited there" });
    await deleteLink(here, kb, kc);
    await removeNode(there, ka);

    const result = await syncNow(createRepositories(here).exchange, new Map(), exchange);
    expect(await snapshot(here)).toEqual(await snapshot(there));
    expect((await listLinks(here)).map((l) => [l.from, l.to, l.comment])).toEqual([
      [ka, kb, "edited there"],
    ]);
    expect(await listNodes(here)).toEqual([]);
    expect(changeCount(result.received)).toBe(2);
    expect(result.sent?.links.deleted).toBe(1);
  });

  it("a second sync changes nothing", async () => {
    await createLink(here, a, b);
    await syncNow(createRepositories(here).exchange, new Map(), exchange);
    const again = await syncNow(createRepositories(here).exchange, new Map(), exchange);
    expect(changeCount(again.received)).toBe(0);
    expect(changeCount(again.sent)).toBe(0);
  });

  it("changes nothing here when the peer sends garbage", async () => {
    await createLink(here, a, b);
    const before = await snapshot(here);
    await expect(
      syncNow(createRepositories(here).exchange, new Map(), async () => ({
        data: { nope: 1 },
        summary: {},
      })),
    ).rejects.toThrow(/mixmap/);
    expect(await snapshot(here)).toEqual(before);
  });
});
