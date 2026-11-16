import { describe, expect, it } from "vitest";
import { type FilterSubject, isActive, matches, matchingNodes } from "./filters";

const subject: FilterSubject = {
  artist: "Chase & Status",
  bpm: 174,
  comment: "big tune",
  genre: "Drum & Bass",
  key: "11A",
  linkComments: ["Long filter blend"],
  rating: 4,
  title: "Problem (RUNNER Remix)",
};

describe("graph filters", () => {
  it("is inactive when empty", () => {
    expect(isActive({})).toBe(false);
    expect(isActive({ name: "  " })).toBe(false);
    expect(isActive({ minRating: 0 })).toBe(false);
    expect(isActive({ bpmMin: 120 })).toBe(true);
    expect(matches({}, subject)).toBe(true);
  });

  it("matches text fields case-insensitively", () => {
    expect(matches({ name: "problem" }, subject)).toBe(true);
    expect(matches({ name: "cola" }, subject)).toBe(false);
    expect(matches({ artist: "STATUS" }, subject)).toBe(true);
    expect(matches({ genre: "techno" }, subject)).toBe(false);
  });

  it("matches comment text in the track or its links", () => {
    expect(matches({ comment: "big" }, subject)).toBe(true);
    expect(matches({ comment: "filter blend" }, subject)).toBe(true);
    expect(matches({ comment: "vocal" }, subject)).toBe(false);
  });

  it("filters by BPM range, rating and key (any notation)", () => {
    expect(matches({ bpmMax: 180, bpmMin: 170 }, subject)).toBe(true);
    expect(matches({ bpmMax: 130 }, subject)).toBe(false);
    expect(matches({ minRating: 4 }, subject)).toBe(true);
    expect(matches({ minRating: 5 }, subject)).toBe(false);
    expect(matches({ key: "11A" }, subject)).toBe(true);
    expect(matches({ key: "F#m" }, subject)).toBe(true);
    expect(matches({ key: "8A" }, subject)).toBe(false);
  });

  it("combines filters with AND; missing tracks fail numeric/key filters", () => {
    expect(matches({ artist: "chase", bpmMin: 175 }, subject)).toBe(false);
    const missing: FilterSubject = { artist: "ZZ", linkComments: [], title: "Gone" };
    expect(matches({ name: "gone" }, missing)).toBe(true);
    expect(matches({ bpmMin: 1 }, missing)).toBe(false);
    expect(matches({ key: "8A" }, missing)).toBe(false);
  });
});

describe("compatible filter", () => {
  it("combines with the other filters", () => {
    const compat = { bpmTolerance: 6, halfDouble: false, reference: { bpm: 172, key: "10A" } };
    expect(isActive({ compatible: compat })).toBe(true);
    expect(matches({ compatible: compat }, subject)).toBe(true);
    expect(matches({ compatible: compat, name: "cola" }, subject)).toBe(false);
    expect(
      matches({ compatible: { ...compat, reference: { bpm: 128, key: "10A" } } }, subject),
    ).toBe(false);
  });
});

describe("matchingNodes", () => {
  const links = [{ comment: "drop swap", from: "a", to: "b" }];
  const nodes = [
    { card: { artist: "X", key: "a", title: "One" }, id: "a" },
    { card: { artist: "Y", key: "b", title: "Two" }, id: "b" },
    { card: { artist: "Z", key: "c", title: "Three" }, id: "c" },
  ];

  it("returns every node when the filter is empty", () => {
    expect([...matchingNodes({}, nodes, links)]).toEqual(["a", "b", "c"]);
  });

  it("uses link comments of both endpoints", () => {
    expect([...matchingNodes({ comment: "swap" }, nodes, links)]).toEqual(["a", "b"]);
    expect([...matchingNodes({ name: "three" }, nodes, links)]).toEqual(["c"]);
  });
});
