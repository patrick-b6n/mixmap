import { describe, expect, it } from "vitest";
import { track } from "./__tests__/fixtures";
import { buildIndex, combine, decksWith, resolveTrack, shownDecks, typeahead } from "./nowPlaying";

const lib = [
  track("1", "ATB", "Ecstasy (Ascend Mix)"),
  track("2", "Chase & Status", "Problem (RUNNER Remix)"),
  track("3", "Rusko, Netsky", "Everyday (REAPER Bootleg)"),
  track("4", "Artist X", "Intro"),
  track("5", "Artist Y", "Intro"),
  track("6", "Artist X", "Intro"),
];
const index = buildIndex(lib);
const byId = new Map(lib.map((t) => [t.id, t]));
const id = (r: ReturnType<typeof resolveTrack>) => (r.kind === "matched" ? r.track.id : r.kind);

describe("resolving now-playing titles", () => {
  it("matches title and artist, ignoring case and punctuation", () => {
    expect(id(resolveTrack("ecstasy ascend mix", "atb", index))).toBe("1");
    expect(id(resolveTrack("Problem (RUNNER Remix)", "Chase and Status", index))).toBe("2");
  });

  it("accepts a shortened artist", () => {
    expect(id(resolveTrack("Everyday (REAPER Bootleg)", "Rusko", index))).toBe("3");
  });

  it("reports ambiguity, unless exactly one candidate is preferred", () => {
    const r = resolveTrack("Intro", "Artist X", index);
    expect(r.kind === "ambiguous" && r.candidates.map((t) => t.id)).toEqual(["4", "6"]);
    expect(id(resolveTrack("Intro", "Artist X", index, (t) => t.id === "6"))).toBe("6");
    expect(id(resolveTrack("Intro", "", index))).toBe("ambiguous");
  });

  it("knows empty decks and unknown tracks", () => {
    expect(id(resolveTrack("  ", "x", index))).toBe("empty");
    expect(resolveTrack("Nope", "Nobody", index)).toEqual({
      artist: "Nobody",
      kind: "unknown",
      title: "Nope",
    });
  });
});

describe("combining sources", () => {
  const auto = {
    decks: [
      { artist: "ATB", deck: 2, title: "Ecstasy (Ascend Mix)" },
      { artist: "Chase & Status", deck: 1, title: "Problem (RUNNER Remix)" },
    ],
    master: 1,
    source: "memory",
    status: "ok" as const,
  };

  it("uses the automatic source, sorted by deck", () => {
    const s = combine(auto, { decks: {} }, index, byId);
    expect(s.decks.map((d) => [d.deck, id(d.resolution), d.manual])).toEqual([
      [1, "2", false],
      [2, "1", false],
    ]);
    expect(s.master).toBe(1);
  });

  it("lets manual mode override a deck, add decks and set the master", () => {
    const s = combine(auto, { decks: { 2: "3", 3: "1" }, master: 3 }, index, byId);
    expect(s.decks.map((d) => [d.deck, id(d.resolution), d.manual])).toEqual([
      [1, "2", false],
      [2, "3", true],
      [3, "1", true],
    ]);
    expect(s.master).toBe(3);
    expect(decksWith(s, "1")).toEqual([3]);
  });

  it("works with manual mode alone when the source is unavailable", () => {
    const down = {
      reason: "rekordbox is not running",
      source: "memory",
      status: "unavailable" as const,
    };
    const s = combine(down, { decks: { 1: "2" } }, index, byId);
    expect(s.decks.map((d) => [d.deck, id(d.resolution)])).toEqual([[1, "2"]]);
    expect(s.master).toBeUndefined();
  });
});

describe("manual mode type-ahead", () => {
  it("finds tracks by title or artist, title matches first", () => {
    const lib2 = [track("a", "Problem Child", "Song"), track("b", "X", "Problem")];
    expect(typeahead(lib2, "problem", []).map((t) => t.id)).toEqual(["b", "a"]);
    expect(typeahead(lib, "intro artist x", []).map((t) => t.id)).toEqual(["4", "6"]);
  });

  it("suggests without a query and respects the limit", () => {
    expect(typeahead(lib, " ", [lib[2]!, lib[0]!]).map((t) => t.id)).toEqual(["3", "1"]);
    expect(typeahead(lib, "", lib, 2)).toHaveLength(2);
  });

  it("always shows decks 1 and 2", () => {
    expect(shownDecks({ decks: [], master: undefined })).toEqual([1, 2]);
    const s = combine(undefined, { decks: { 4: "1" } }, index, byId);
    expect(shownDecks(s)).toEqual([1, 2, 4]);
  });
});
