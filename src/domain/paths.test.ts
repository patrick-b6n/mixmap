import { describe, expect, it } from "vitest";
import { pathEdges, shortestPaths } from "./paths";

const l = (from: string, to: string, rating: number | null = null) => ({ from, rating, to });

const k = (r: number, c: number) => `${r}:${c}`;

describe("shortest paths", () => {
  //  a → b → d → e
  //  a → c → d
  //  a → x → y → z → e   (longer)
  const links = [
    l("a", "b", 2),
    l("b", "d", 2),
    l("a", "c", 5),
    l("c", "d", 4),
    l("d", "e"),
    l("a", "x"),
    l("x", "y"),
    l("y", "z"),
    l("z", "e"),
  ];

  it("finds all shortest paths, best rated first", () => {
    const p = shortestPaths(links, "a", "e");
    expect(p.map((x) => x.keys.join(""))).toEqual(["acde", "abde"]);
    expect(p[0].rating).toBe(9);
  });

  it("follows link direction", () => {
    expect(shortestPaths(links, "e", "a")).toEqual([]);
    expect(shortestPaths(links, "d", "e").map((x) => x.keys)).toEqual([["d", "e"]]);
  });

  it("handles unknown tracks, self paths, cycles and limits", () => {
    expect(shortestPaths(links, "a", "nope")).toEqual([]);
    expect(shortestPaths(links, "a", "a")).toEqual([{ keys: ["a"], rating: 0 }]);
    const cyclic = [l("a", "b"), l("b", "a"), l("b", "c"), l("a", "c2"), l("c2", "c")];
    expect(shortestPaths(cyclic, "a", "c").map((x) => x.keys.join(""))).toEqual(["abc", "ac2c"]);
    expect(shortestPaths(cyclic, "a", "c", 1)).toHaveLength(1);
  });

  it("stays fast on large graphs", () => {
    // A 60×60 grid with links right and down: C(118, 59) shortest paths from corner to corner.
    const big = [];
    for (let r = 0; r < 60; r++) {
      for (let c = 0; c < 60; c++) {
        if (c + 1 < 60) big.push(l(k(r, c), k(r, c + 1)));
        if (r + 1 < 60) big.push(l(k(r, c), k(r + 1, c)));
      }
    }
    const t = performance.now();
    const p = shortestPaths(big, k(0, 0), k(59, 59), 3);
    expect(p).toHaveLength(3);
    expect(p[0].keys).toHaveLength(119);
    expect(performance.now() - t).toBeLessThan(500);
  });

  it("lists the edges of a path", () => {
    expect([...pathEdges(["a", "b", "c"])]).toEqual(["a\u0001b", "b\u0001c"]);
  });
});
