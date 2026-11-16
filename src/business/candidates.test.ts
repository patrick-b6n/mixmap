import { describe, expect, it } from "vitest";
import { rankCandidates, similarity } from "./candidates";

const lib = [
  { album: "", artist: "ATB", id: "1", length: 353, title: "Ecstasy" },
  { album: "", artist: "ATB", id: "2", length: 240, title: "Ecstasy (Radio Edit)" },
  { album: "Trance Hits", artist: "Other", id: "3", length: 300, title: "Something" },
  { album: "", artist: "A.T.B.", id: "4", length: 354, title: "9 PM" },
];
const target = { artist: "ATB", duration: 352, title: "Ecstasy" };

describe("candidate search", () => {
  it("scores shared words and penalizes duration differences", () => {
    expect(similarity(target, lib[0]!)).toBeGreaterThan(similarity(target, lib[1]!));
    expect(similarity(target, lib[2]!)).toBeLessThanOrEqual(0);
  });

  it("without a query offers tracks sharing a word, best first", () => {
    expect(rankCandidates(target, lib, "").map((c) => c.id)).toEqual(["1", "2"]);
  });

  it("with a query, every word must start a word of artist, title or album", () => {
    expect(rankCandidates(target, lib, "trance").map((c) => c.id)).toEqual(["3"]);
    expect(rankCandidates(target, lib, "atb radio").map((c) => c.id)).toEqual(["2"]);
    expect(rankCandidates(target, lib, "a.t.b").map((c) => c.id)).toEqual(["4"]);
    expect(rankCandidates(target, lib, "ecst").map((c) => c.id)).toEqual(["1", "2"]);
    expect(rankCandidates(target, lib, "9 pm").map((c) => c.id)).toEqual(["4"]);
  });

  it("respects the limit", () => {
    expect(rankCandidates(target, lib, "", 1)).toHaveLength(1);
  });
});
