import { describe, expect, it } from "vitest";
import type { Track } from "../api";
import type { Link } from "../db/links";
import type { TrackRow } from "../db/tracks";
import { buildGraph, canLink, edgeId, edgeWidth, linkCounts } from "./graph";

const link = (from: string, to: string, rating: number | null = null, comment = ""): Link => ({
  comment,
  createdAt: 0,
  from,
  rating,
  tags: [],
  to,
  updatedAt: 0,
});

const row = (key: string, rekordboxId: string | null, missing = false): TrackRow => ({
  artist: `${key} artist`,
  duration: 300,
  key,
  missing,
  rekordboxId,
  title: `${key} title`,
});

const rb = (id: string, title: string): Track => ({
  album: "",
  artist: "RB Artist",
  artworkPath: null,
  bpm: 128,
  comment: "",
  filePath: "",
  genre: "",
  id,
  key: "8A",
  length: 300,
  rating: 0,
  title,
});

describe("graph", () => {
  it("allows new directions only", () => {
    const links = [link("a", "b")];
    expect(canLink(links, "a", "b")).toBe(false);
    expect(canLink(links, "b", "a")).toBe(true);
    expect(canLink(links, "a", "a")).toBe(false);
  });

  it("sizes edges by rating", () => {
    expect(edgeWidth(null)).toBe(1.5);
    expect(edgeWidth(1)).toBe(1.5);
    expect(edgeWidth(5)).toBe(5.5);
  });

  it("counts links in both directions over all boards", () => {
    const counts = linkCounts([link("a", "b"), link("b", "a"), link("b", "c")]);
    expect(Object.fromEntries(counts)).toEqual({ a: 2, b: 3, c: 1 });
  });

  it("builds nodes from rekordbox tracks or the stored copy when missing", () => {
    const tracks = new Map([
      ["a", row("a", "rb1")],
      ["b", row("b", "rb2", true)],
      ["c", row("c", "rb3")],
    ]);
    const library = new Map([
      ["rb1", rb("rb1", "Ecstasy")],
      ["rb3", rb("rb3", "Cola")],
    ]);
    const links = [link("a", "b", 4, "nice"), link("b", "c"), link("c", "x")];
    const g = buildGraph(
      [
        { boardId: "B", trackKey: "a", x: 1, y: 2 },
        { boardId: "B", trackKey: "b", x: 3, y: 4 },
      ],
      links,
      tracks,
      library,
    );
    expect(g.nodes.map((n) => [n.id, n.card.title, n.card.missing, n.card.linkCount, n.x])).toEqual([
      ["a", "Ecstasy", false, 1, 1],
      ["b", "b title", true, 2, 3],
    ]);
    expect(g.nodes[0].card.track?.bpm).toBe(128);
    // Only links with both endpoints on the board.
    expect(g.edges).toEqual([{ comment: "nice", from: "a", id: edgeId("a", "b"), rating: 4, to: "b", width: 4.5 }]);
  });
});
