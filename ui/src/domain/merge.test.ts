import { describe, expect, it } from "vitest";
import type { ExportLink, ExportTrack, MixmapExport } from "../db/exchange";
import { portableKey } from "./matching";
import { emptyExport, mergeData, resolveManualMatch } from "./merge";

const tr = (key: string, ts = 1): ExportTrack => ({
  artist: key,
  createdAt: ts,
  duration: 200,
  key,
  title: key,
  updatedAt: ts,
});
const ln = (from: string, to: string, ts: number, comment = ""): ExportLink => ({
  comment,
  createdAt: 1,
  from,
  rating: null,
  tags: [],
  to,
  updatedAt: ts,
});
const data = (patch: Partial<MixmapExport>): MixmapExport => ({
  ...emptyExport(),
  tracks: [tr("a"), tr("b"), tr("c")],
  ...patch,
});
const L = (from: string, to: string) => `${from}\u0001${to}`;

describe("merge", () => {
  it("adds everything into an empty database", () => {
    const plan = mergeData(emptyExport(), data({ links: [ln("a", "b", 5)] }));
    expect(plan.tracks).toHaveLength(3);
    expect(plan.links).toEqual([ln("a", "b", 5)]);
    expect(plan.summary.links).toEqual({ added: 1, deleted: 0, updated: 0 });
  });

  it("is last-write-wins per item", () => {
    const local = data({ links: [ln("a", "b", 5, "mine"), ln("b", "c", 5, "mine")] });
    const incoming = data({ links: [ln("a", "b", 6, "theirs"), ln("b", "c", 4, "older")] });
    const plan = mergeData(local, incoming);
    expect(plan.links.map((l) => l.comment)).toEqual(["theirs"]);
    expect(plan.summary.links).toEqual({ added: 0, deleted: 0, updated: 1 });
    // Same tracks with the same timestamps: nothing to do.
    expect(plan.tracks).toEqual([]);
  });

  it("propagates deletions newer than the row, and only those", () => {
    const local = data({ links: [ln("a", "b", 5), ln("b", "c", 5)] });
    const incoming = data({
      tombstones: [
        { deletedAt: 6, id: L("a", "b"), kind: "link" },
        { deletedAt: 4, id: L("b", "c"), kind: "link" },
      ],
    });
    const plan = mergeData(local, incoming);
    expect(plan.deletes).toEqual([{ deletedAt: 6, id: L("a", "b"), kind: "link" }]);
    expect(plan.summary.links.deleted).toBe(1);
  });

  it("keeps a local deletion against an older row, revives against a newer one", () => {
    const local = data({ tombstones: [{ deletedAt: 5, id: L("a", "b"), kind: "link" }] });
    expect(mergeData(local, data({ links: [ln("a", "b", 4)] })).links).toEqual([]);
    expect(mergeData(local, data({ links: [ln("a", "b", 6)] })).links).toEqual([ln("a", "b", 6)]);
  });

  it("records incoming tombstones for rows it never had", () => {
    const plan = mergeData(emptyExport(), data({ tombstones: [{ deletedAt: 3, id: L("a", "c"), kind: "link" }] }));
    expect(plan.deletes).toEqual([]);
    expect(plan.tombstones).toEqual([{ deletedAt: 3, id: L("a", "c"), kind: "link" }]);
  });

  it("sees the same row built with another key order as unchanged", () => {
    const l = ln("a", "b", 5, "same");
    const reordered = Object.fromEntries(Object.entries(l).toReversed()) as ExportLink;
    const plan = mergeData(data({ links: [l] }), data({ links: [reordered] }));
    expect(plan.links).toEqual([]);
    expect(plan.summary.links).toEqual({ added: 0, deleted: 0, updated: 0 });
  });

  it("breaks timestamp ties the same way on both sides", () => {
    const x = data({ links: [ln("a", "b", 5, "x")] });
    const y = data({ links: [ln("a", "b", 5, "y")] });
    expect(mergeData(x, y).links.map((l) => l.comment)).toEqual(["y"]);
    expect(mergeData(y, x).links).toEqual([]);
    // A deletion wins a tie with a row.
    const del = data({ tombstones: [{ deletedAt: 5, id: L("a", "b"), kind: "link" }] });
    expect(mergeData(x, del).deletes).toHaveLength(1);
    expect(mergeData(del, x).links).toEqual([]);
  });

  it("deletes a board's nodes with the board", () => {
    const board = { createdAt: 1, id: "B", name: "Peak", position: 0, updatedAt: 1 };
    const node = { boardId: "B", createdAt: 1, trackKey: "a", updatedAt: 1, x: 0, y: 0 };
    const local = data({ boardNodes: [node], boards: [board] });
    const plan = mergeData(local, data({ tombstones: [{ deletedAt: 9, id: "B", kind: "board" }] }));
    expect(plan.deletes).toEqual([
      { deletedAt: 9, id: L("B", "a"), kind: "board_node" },
      { deletedAt: 9, id: "B", kind: "board" },
    ]);
    expect(plan.summary.boardNodes.deleted).toBe(1);
  });

  it("drops rows whose board or track doesn't survive, and never deletes a referenced track", () => {
    const local = data({
      links: [ln("a", "b", 5)],
      tombstones: [{ deletedAt: 9, id: "B", kind: "board" }],
    });
    const incoming = data({
      boardNodes: [{ boardId: "B", createdAt: 1, trackKey: "c", updatedAt: 2, x: 0, y: 0 }],
      boards: [{ createdAt: 1, id: "B", name: "old", position: 0, updatedAt: 2 }],
      tombstones: [{ deletedAt: 9, id: "a", kind: "track" }],
      tracks: [tr("b"), tr("c")],
    });
    const plan = mergeData(local, incoming);
    expect(plan.boards).toEqual([]);
    expect(plan.boardNodes).toEqual([]);
    expect(plan.summary.boardNodes.added).toBe(0);
    // Track a still has link a → b here.
    expect(plan.deletes.filter((d) => d.kind === "track")).toEqual([]);
  });
});

describe("manual match resolution", () => {
  const t = { artist: "ATB", length: 353, title: "Ecstasy" };
  const other = { artist: "Other", length: 100, title: "Song" };
  const key = portableKey(t);

  it("keeps the id when it is still the same track", () => {
    expect(resolveManualMatch({ rekordboxId: "1", targetKey: key }, new Map([["1", t]]))).toBe("1");
  });

  it("finds the track by its portable key on another machine", () => {
    const lib = new Map([
      ["1", other],
      ["7", t],
    ]);
    expect(resolveManualMatch({ rekordboxId: "1", targetKey: key }, lib)).toBe("7");
  });

  it("gives up when the target is unknown or ambiguous", () => {
    expect(resolveManualMatch({ rekordboxId: "1", targetKey: key }, new Map([["1", other]]))).toBeNull();
    const twice = new Map([
      ["7", t],
      ["8", t],
    ]);
    expect(resolveManualMatch({ rekordboxId: "1", targetKey: key }, twice)).toBeNull();
  });

  it("keeps the id as is without a target key", () => {
    expect(resolveManualMatch({ rekordboxId: "1", targetKey: null }, new Map())).toBe("1");
  });

  it("drops unresolvable matches from the plan", () => {
    const m = { createdAt: 1, rekordboxId: "1", targetKey: key, trackKey: "a", updatedAt: 1 };
    const plan = mergeData(emptyExport(), data({ manualMatches: [m] }), new Map([["1", other]]));
    expect(plan.manualMatches).toEqual([]);
    expect(plan.summary.manualMatches.added).toBe(0);
  });
});
