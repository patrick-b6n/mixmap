import { describe, expect, it } from "vitest";
import type { Link } from "./links";
import type { TrackRow } from "./model";
import { track } from "./__tests__/fixtures";
import { portableKey } from "./matching";
import { outgoingLinks } from "./overlay";

const a = track("1", "ATB", "Ecstasy");
const b = track("2", "Caru", "San Andreas");
const c = track("3", "Cloonee", "X-Rated");
const [ka, kb, kc] = [a, b, c].map(portableKey);
const link = (from: string, to: string, rating: number | null, comment = ""): Link => ({
  comment,
  createdAt: 1,
  from,
  rating,
  tags: [],
  to,
  updatedAt: 1,
});
const row = (t: typeof a, missing = false): TrackRow => ({
  artist: t.artist,
  duration: t.length,
  key: portableKey(t),
  missing,
  rekordboxId: t.id,
  title: t.title,
});

describe("overlay links", () => {
  const tracks = new Map([
    [ka, row(a)],
    [kb, row(b)],
    [kc, row(c, true)],
  ]);
  const library = new Map([a, b, c].map((t) => [t.id, t]));
  const links = [link(ka, kc, null), link(ka, kb, 4, "long blend"), link(kb, ka, 5)];

  it("lists outgoing links best rated first, with the target's data", () => {
    const rows = outgoingLinks(a, 1, links, tracks, library, { decks: [], master: undefined });
    expect(rows.map((r) => [r.targetTitle, r.rating, r.comment, r.target?.id])).toEqual([
      ["San Andreas", 4, "long blend", "2"],
      // Missing in rekordbox: shown from mixmap.db, no track data.
      ["X-Rated", null, "", undefined],
    ]);
  });

  it("marks targets loaded on another deck", () => {
    const state = {
      decks: [
        { deck: 1, manual: true, resolution: { kind: "matched" as const, track: a } },
        { deck: 2, manual: true, resolution: { kind: "matched" as const, track: b } },
      ],
      master: 1,
    };
    expect(outgoingLinks(a, 1, links, tracks, library, state)[0].loadedOn).toEqual([2]);
    // Its own deck doesn't count.
    expect(outgoingLinks(b, 2, links, tracks, library, state)[0].loadedOn).toEqual([1]);
  });
});
