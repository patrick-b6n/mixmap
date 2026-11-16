import { describe, expect, it } from "vitest";
import { errorMessage } from "../errors";
import { rows } from "./SyncSection";

const peer = (id: string, name: string) => ({
  addresses: ["192.168.1.2"],
  id,
  name,
  port: 4000,
  protocol: 1,
});
const paired = (id: string, name: string) => ({
  id,
  lastAddress: null,
  lastSyncAt: null,
  name,
  pairedAt: 1,
});

describe("sync device list", () => {
  it("merges discovered and paired devices, sorted by name", () => {
    const list = rows({
      device: { id: "me", name: "Me" },
      error: null,
      paired: [paired("b", "Booth"), paired("c", "Club")],
      peers: [peer("b", "Booth"), peer("a", "Attic")],
      port: 1,
    });
    expect(list.map((r) => [r.name, r.paired, r.online !== undefined])).toEqual([
      ["Attic", false, true],
      ["Booth", true, true],
      ["Club", true, false],
    ]);
  });

  it("strips the command and status from backend errors", () => {
    expect(errorMessage(new Error("pair_confirm: 403 wrong code"))).toBe("wrong code");
    expect(errorMessage("plain")).toBe("plain");
  });
});
