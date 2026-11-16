import { describe, expect, it } from "vitest";
import { bpmCompatible, compatible, keysCompatible } from "./compatibility";
import { parseKey } from "./keys";

const k = (s: string) => parseKey(s)!;

describe("key compatibility", () => {
  it("accepts same, ±1 and relative major/minor", () => {
    expect(keysCompatible(k("8A"), k("8A"))).toBe(true);
    expect(keysCompatible(k("8A"), k("7A"))).toBe(true);
    expect(keysCompatible(k("8A"), k("9A"))).toBe(true);
    expect(keysCompatible(k("8A"), k("8B"))).toBe(true);
    expect(keysCompatible(k("Am"), k("C"))).toBe(true);
  });

  it("wraps around the wheel", () => {
    expect(keysCompatible(k("12B"), k("1B"))).toBe(true);
    expect(keysCompatible(k("1A"), k("12A"))).toBe(true);
  });

  it("rejects everything else", () => {
    expect(keysCompatible(k("8A"), k("10A"))).toBe(false);
    expect(keysCompatible(k("8A"), k("9B"))).toBe(false);
    expect(keysCompatible(k("8A"), k("7B"))).toBe(false);
  });
});

describe("BPM compatibility", () => {
  it("uses a percentage tolerance", () => {
    expect(bpmCompatible(100, 106, 6, false)).toBe(true);
    expect(bpmCompatible(100, 94, 6, false)).toBe(true);
    expect(bpmCompatible(100, 106.5, 6, false)).toBe(false);
    expect(bpmCompatible(174, 128, 6, false)).toBe(false);
  });

  it("optionally accepts half and double tempo", () => {
    expect(bpmCompatible(174, 87, 6, false)).toBe(false);
    expect(bpmCompatible(174, 87, 6, true)).toBe(true);
    expect(bpmCompatible(87, 172, 6, true)).toBe(true);
    expect(bpmCompatible(128, 87, 6, true)).toBe(false);
  });
});

describe("compatible with selected", () => {
  const rule = { bpmTolerance: 6, halfDouble: false, reference: { bpm: 174, key: "11A" } };

  it("needs both key and BPM to fit", () => {
    expect(compatible(rule, { bpm: 172, key: "10A" })).toBe(true);
    expect(compatible(rule, { bpm: 172, key: "5A" })).toBe(false);
    expect(compatible(rule, { bpm: 140, key: "11A" })).toBe(false);
  });

  it("treats unknown values on the candidate as not compatible", () => {
    expect(compatible(rule, {})).toBe(false);
    expect(compatible(rule, { bpm: 174 })).toBe(false);
    expect(compatible(rule, { key: "11A" })).toBe(false);
  });

  it("skips the part the selected track doesn't know", () => {
    expect(compatible({ ...rule, reference: { bpm: 0, key: "11A" } }, { key: "11B" })).toBe(true);
    expect(compatible({ ...rule, reference: { bpm: 174, key: "" } }, { bpm: 170 })).toBe(true);
  });
});
