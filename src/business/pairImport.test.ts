import { describe, expect, it } from "vitest";
import { portableKey } from "./matching";
import { type ProposedPair, proposePairs } from "./pairImport";

const t = (id: string, title: string, length = 200) => ({ artist: "X", id, length, title });
const lib = new Map(
  [t("1", "One"), t("2", "Two"), t("3", "Three"), t("2b", "Two") /* same audio, other id */].map(
    (x) => [x.id, x],
  ),
);
const k = (id: string) => portableKey(lib.get(id)!);
const ids = (pairs: ProposedPair<ReturnType<typeof t>>[]) =>
  pairs.map((p) => `${p.from.id}>${p.to.id}`);

describe("pair import", () => {
  it("proposes back-to-back pairs in order", () => {
    expect(ids(proposePairs(["1", "2", "3"], lib, []))).toEqual(["1>2", "2>3"]);
  });

  it("skips unknown tracks and the same track twice in a row", () => {
    expect(ids(proposePairs(["1", "gone", "2", "2b", "3"], lib, []))).toEqual(["2b>3"]);
  });

  it("de-duplicates by direction and counts occurrences", () => {
    const pairs = proposePairs(["1", "2", "1", "2", "3"], lib, []);
    expect(ids(pairs)).toEqual(["1>2", "2>1", "2>3"]);
    expect(pairs[0]?.occurrences).toBe(2);
  });

  it("marks links that already exist", () => {
    const pairs = proposePairs(["1", "2", "3"], lib, [{ from: k("1"), to: k("2") }]);
    expect(pairs.map((p) => p.exists)).toEqual([true, false]);
  });

  it("needs at least two tracks", () => {
    expect(proposePairs(["1"], lib, [])).toEqual([]);
    expect(proposePairs([], lib, [])).toEqual([]);
  });
});
