import { describe, expect, it } from "vitest";
import type { Playlist } from "../api";
import { buildTree, findNode, trackIdsOf } from "./playlistTree";

const pl = (
  id: string,
  parentId: string | null,
  seq: number,
  kind: Playlist["kind"] = "playlist",
  trackIds: string[] = [],
): Playlist => ({
  id,
  kind,
  name: id,
  parentId,
  seq,
  trackIds,
});

describe("playlistTree", () => {
  const lists = [
    pl("b", null, 2, "folder"),
    pl("a", null, 1, "playlist", ["1"]),
    pl("b2", "b", 2, "playlist", ["3", "1"]),
    pl("b1", "b", 1, "playlist", ["1", "2"]),
    pl("orphan", "gone", 0),
  ];

  it("nests and sorts by seq; orphans become roots", () => {
    const tree = buildTree(lists);
    expect(tree.map((n) => n.playlist.id)).toEqual(["orphan", "a", "b"]);
    expect(tree[2].children.map((n) => n.playlist.id)).toEqual(["b1", "b2"]);
  });

  it("collects folder contents in order without duplicates", () => {
    const tree = buildTree(lists);
    expect(trackIdsOf(findNode(tree, "b")!)).toEqual(["1", "2", "3"]);
    expect(trackIdsOf(findNode(tree, "b2")!)).toEqual(["3", "1"]);
    expect(findNode(tree, "nope")).toBeUndefined();
  });

  it("survives a self-parent and parent cycles", () => {
    expect(buildTree([pl("x", "x", 0)]).map((n) => n.playlist.id)).toEqual(["x"]);
    const tree = buildTree([pl("a", "b", 1), pl("b", "a", 2), pl("c", "a", 0)]);
    expect(tree.map((n) => n.playlist.id)).toEqual(["a", "b"]);
    expect(tree[0].children.map((n) => n.playlist.id)).toEqual(["c"]);
  });
});
