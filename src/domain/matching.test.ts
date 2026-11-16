import { describe, expect, it } from "vitest";
import { type LibraryTrack, matchTracks, normalize, portableKey, type StoredTrack } from "./matching";

const lib = (id: string, artist: string, title: string, length: number): LibraryTrack => ({
  artist,
  id,
  length,
  title,
});
const stored = (t: LibraryTrack, rekordboxId: string | null = null): StoredTrack => ({
  key: portableKey(t),
  rekordboxId,
});

describe("portable key", () => {
  it("normalizes case, accents, punctuation and ampersands", () => {
    expect(normalize("  Röyksopp & Robyn – Do It Again!! ")).toBe("royksopp and robyn do it again");
    expect(normalize("CamelPhat, Elderbrook")).toBe("camelphat elderbrook");
    expect(portableKey({ artist: "ATB", length: 353.4, title: "Ecstasy (Ascend Mix)" })).toBe(
      "atb|ecstasy ascend mix|353",
    );
  });

  it("keeps non-Latin scripts intact", () => {
    expect(normalize("が")).not.toBe(normalize("か"));
    expect(normalize("й")).not.toBe(normalize("и"));
    expect(normalize("Привет Мир")).toBe("привет мир");
    expect(normalize("東京 Night")).toBe("東京 night");
  });

  it("is the same for the same track on another machine", () => {
    const a = { artist: "Caru", length: 197, title: "San Andreas (Dub Mix)" };
    const b = { artist: "CARU ", length: 197.2, title: "San Andreas [Dub Mix]" };
    expect(portableKey(a)).toBe(portableKey(b));
  });
});

describe("matchTracks", () => {
  const a = lib("rb1", "ATB", "Ecstasy", 353);
  const b = lib("rb2", "Caru", "San Andreas", 197);
  const b2 = lib("rb3", "Caru", "San Andreas", 197); // duplicate in the library
  const c = lib("rb4", "Estelle", "American Boy", 345);

  it("matches unique keys and falls back to ±1 s", () => {
    const shifted = { ...c, length: 346 };
    const results = matchTracks([stored(a), stored(shifted)], [a, c], new Map());
    expect(results).toEqual([
      { kind: "matched", rekordboxId: "rb1", trackKey: portableKey(a) },
      { kind: "matched", rekordboxId: "rb4", trackKey: portableKey(shifted) },
    ]);
  });

  it("reports ambiguous candidates unless the cached id is one of them", () => {
    expect(matchTracks([stored(b)], [b, b2], new Map())).toEqual([
      { candidates: ["rb2", "rb3"], kind: "ambiguous", trackKey: portableKey(b) },
    ]);
    expect(matchTracks([stored(b, "rb3")], [b, b2], new Map())).toEqual([
      { kind: "matched", rekordboxId: "rb3", trackKey: portableKey(b) },
    ]);
  });

  it("uses remembered manual matches first", () => {
    const manual = new Map([[portableKey(b), "rb3"]]);
    expect(matchTracks([stored(b)], [b, b2], manual)).toEqual([
      { kind: "matched", rekordboxId: "rb3", trackKey: portableKey(b) },
    ]);
    // A manual match to a track that is gone falls back to normal matching.
    expect(matchTracks([stored(a)], [a], new Map([[portableKey(a), "gone"]]))).toEqual([
      { kind: "matched", rekordboxId: "rb1", trackKey: portableKey(a) },
    ]);
  });

  it("does not give a claimed rekordbox track to a second mixmap track", () => {
    const exact = lib("rb5", "Jay Bird", "Into the Groove", 324);
    const near = { artist: "Jay Bird", id: "x", length: 325, title: "Into the Groove" };
    // `near` would match rb5 via ±1 s, but rb5 belongs to the exact match.
    expect(matchTracks([stored(exact), stored(near)], [exact], new Map()).map((r) => r.kind)).toEqual([
      "matched",
      "unmatched",
    ]);
  });

  it("marks tracks gone from rekordbox as missing, never-matched ones as unmatched", () => {
    expect(matchTracks([stored(a, "rb1"), stored(c)], [b], new Map())).toEqual([
      { kind: "missing", trackKey: portableKey(a) },
      { kind: "unmatched", trackKey: portableKey(c) },
    ]);
  });
});
