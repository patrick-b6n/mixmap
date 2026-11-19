import { describe, expect, it } from "vitest";
import { autoLayout } from "./layout";
import { NODE_HEIGHT, NODE_WIDTH } from "./placement";

const at = (ps: { key: string; x: number; y: number }[], key: string) =>
  ps.find((p) => p.key === key)!;

describe("autoLayout", () => {
  it("lays links out left to right without overlaps", async () => {
    const ps = await autoLayout(
      ["c", "a", "b", "d", "lonely"],
      [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "a", to: "d" },
        { from: "a", to: "not-on-board" },
      ],
    );
    expect(ps.map((p) => p.key).toSorted()).toEqual(["a", "b", "c", "d", "lonely"]);
    expect(at(ps, "a").x).toBeLessThan(at(ps, "b").x);
    expect(at(ps, "b").x).toBeLessThan(at(ps, "c").x);
    expect(at(ps, "a").x).toBeLessThan(at(ps, "d").x);
    for (const p of ps) {
      for (const q of ps) {
        if (p === q) continue;
        const apart = Math.abs(p.x - q.x) >= NODE_WIDTH || Math.abs(p.y - q.y) >= NODE_HEIGHT;
        expect(apart, `${p.key} overlaps ${q.key}`).toBe(true);
      }
    }
  });

  it("handles cycles and empty boards", async () => {
    expect(await autoLayout([], [])).toEqual([]);
    const ps = await autoLayout(
      ["a", "b"],
      [
        { from: "a", to: "b" },
        { from: "b", to: "a" },
      ],
    );
    expect(ps).toHaveLength(2);
  });
});
