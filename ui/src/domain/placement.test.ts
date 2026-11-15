import { describe, expect, it } from "vitest";
import { centeredAt, NODE_HEIGHT, NODE_WIDTH, placeNextTo } from "./placement";

describe("placeNextTo", () => {
  const anchor = { x: 0, y: 0 };
  const right = NODE_WIDTH + 90;

  it("uses the slot beside the anchor when free", () => {
    expect(placeNextTo(anchor, [anchor], "right")).toEqual({ x: right, y: 0 });
    expect(placeNextTo(anchor, [anchor], "left")).toEqual({ x: -right, y: 0 });
  });

  it("goes below, then above, when slots are taken", () => {
    const step = NODE_HEIGHT + 24;
    const taken = [anchor, { x: right, y: 0 }];
    expect(placeNextTo(anchor, taken, "right")).toEqual({ x: right, y: step });
    taken.push({ x: right, y: step });
    expect(placeNextTo(anchor, taken, "right")).toEqual({ x: right, y: -step });
  });

  it("centers dropped cards on the pointer", () => {
    expect(centeredAt({ x: 100, y: 100 })).toEqual({ x: 100 - NODE_WIDTH / 2, y: 100 - NODE_HEIGHT / 2 });
  });
});
