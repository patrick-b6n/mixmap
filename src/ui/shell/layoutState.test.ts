import { describe, expect, it } from "vitest";
import { clampShare, DEFAULT_LAYOUT, parseLayout, shareFromPointer } from "./layoutState";

describe("layoutState", () => {
  it("clamps the splitter", () => {
    expect(clampShare(0.5)).toBe(0.5);
    expect(clampShare(0)).toBe(0.15);
    expect(clampShare(1)).toBe(0.85);
    expect(clampShare(Number.NaN)).toBe(2 / 3);
  });

  it("computes the share from the pointer", () => {
    expect(shareFromPointer(300, 100, 400)).toBe(0.5);
    expect(shareFromPointer(0, 100, 400)).toBe(0.15);
    expect(shareFromPointer(10, 0, 0)).toBe(2 / 3);
  });

  it("parses stored layouts defensively", () => {
    expect(parseLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout("{broken")).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout('{"graphShare":0.4,"leftCollapsed":true}')).toEqual({
      graphShare: 0.4,
      leftCollapsed: true,
      rightCollapsed: false,
    });
    expect(parseLayout('{"graphShare":"x","rightCollapsed":1}')).toEqual(DEFAULT_LAYOUT);
  });
});
