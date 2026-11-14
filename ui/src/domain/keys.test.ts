import { describe, expect, it } from "vitest";
import { camelot, type Key, musical, parseKey } from "./keys";

const p = (s: string) => {
  const k = parseKey(s);
  return k && camelot(k);
};

describe("keys", () => {
  it("round-trips all 24 keys", () => {
    for (let num = 1; num <= 12; num++) {
      for (const minor of [true, false]) {
        const k: Key = { minor, num };
        expect(parseKey(camelot(k))).toEqual(k);
        expect(parseKey(musical(k))).toEqual(k);
      }
    }
  });

  it("maps Camelot to musical notation", () => {
    const cases = [
      ["1A", "Abm"], ["2A", "Ebm"], ["3A", "Bbm"], ["4A", "Fm"], ["5A", "Cm"], ["6A", "Gm"],
      ["7A", "Dm"], ["8A", "Am"], ["9A", "Em"], ["10A", "Bm"], ["11A", "F#m"], ["12A", "C#m"],
      ["1B", "B"], ["2B", "F#"], ["3B", "Db"], ["4B", "Ab"], ["5B", "Eb"], ["6B", "Bb"],
      ["7B", "F"], ["8B", "C"], ["9B", "G"], ["10B", "D"], ["11B", "A"], ["12B", "E"],
    ];
    for (const [c, m] of cases) {
      const k = parseKey(c)!;
      expect(camelot(k)).toBe(c);
      expect(musical(k)).toBe(m);
    }
  });

  it("handles spellings, enharmonics and Open Key", () => {
    expect(p("G#m")).toBe("1A");
    expect(p("D#m")).toBe("2A");
    expect(p("Gb")).toBe("2B");
    expect(p("C#")).toBe("3B");
    expect(p("A minor")).toBe("8A");
    expect(p("c major")).toBe("8B");
    expect(p("bbmin")).toBe("3A");
    expect(p("8a")).toBe("8A");
    expect(p("Cb")).toBe("1B");
    expect(p("E#")).toBe("7B");
    expect(p("B#m")).toBe("5A");
    expect(p("D♭")).toBe("3B");
    for (let n = 1; n <= 12; n++) {
      const c = ((n + 6) % 12) + 1;
      expect(p(`${n}d`)).toBe(`${c}B`);
      expect(p(`${n}m`)).toBe(`${c}A`);
    }
  });

  it("rejects garbage", () => {
    for (const s of ["", "13A", "0B", "H", "Am7", "8C", "x"]) expect(parseKey(s)).toBeUndefined();
  });
});
