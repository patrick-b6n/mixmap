import { describe, expect, it } from "vitest";
import { nextBoardName } from "./BoardTabs";

describe("nextBoardName", () => {
  it("counts up and skips names in use", () => {
    expect(nextBoardName([])).toBe("Board 1");
    expect(nextBoardName([{ name: "Warm-up" }])).toBe("Board 2");
    expect(nextBoardName([{ name: "Board 2" }])).toBe("Board 3");
  });
});
