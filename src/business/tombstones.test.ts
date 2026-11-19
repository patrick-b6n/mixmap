import { describe, expect, it } from "vitest";
import { tombstoneId } from "./tombstones";

describe("tombstoneId", () => {
  it("builds tombstone ids from natural keys", () => {
    expect(tombstoneId("atb|ecstasy|353")).toBe("atb|ecstasy|353");
    expect(tombstoneId("a|b|1", "c|d|2")).toBe(["a|b|1", "c|d|2"].join(String.fromCharCode(1)));
  });
});
