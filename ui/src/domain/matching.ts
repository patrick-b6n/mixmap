// Portable track identity: rekordbox ids and file paths differ between machines, so
// MixMap identifies tracks by normalized artist + title + duration (seconds).

/** Minimal track shape needed for identity. */
export type TrackIdentity = { artist: string; length: number; title: string };

/**
 * Lower-case, strip accents from Latin letters (é → e) and punctuation, collapse
 * whitespace. Other scripts keep their marks (Cyrillic й, Japanese が, Thai/Indic
 * vowel signs), since there they distinguish letters.
 */
export function normalize(s: string): string {
  return Array.from(s.normalize("NFC"), (c) =>
    LATIN.test(c) ? c.normalize("NFKD").replace(/[̀-ͯ]/g, "") : c.normalize("NFKC"),
  )
    .join("")
    .toLocaleLowerCase("en")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();
}

const LATIN = /\p{Script=Latin}/u;

/** `artist|title|seconds`, stable across machines for the same audio file. */
export function portableKey(t: TrackIdentity): string {
  return `${normalize(t.artist)}|${normalize(t.title)}|${Math.round(t.length)}`;
}

/** Key without the duration, for the ±1 s fallback. */
function nameKey(t: TrackIdentity): string {
  return `${normalize(t.artist)}|${normalize(t.title)}`;
}

/** A track stored in mixmap.db (only the fields matching needs); `key` is its portable key. */
export type StoredTrack = { key: string; rekordboxId: string | null };

/** A track from the current rekordbox library. */
export type LibraryTrack = TrackIdentity & { id: string };

export type MatchResult =
  /** Found exactly one rekordbox track (or a remembered manual match). */
  | { kind: "matched"; rekordboxId: string; trackKey: string }
  /** Several rekordbox tracks fit; the user has to pick one. */
  | { candidates: string[]; kind: "ambiguous"; trackKey: string }
  /** Never matched on this machine (e.g. after import/sync); needs manual mapping. */
  | { kind: "unmatched"; trackKey: string }
  /** Was matched before but its rekordbox track is gone: shown as missing. */
  | { kind: "missing"; trackKey: string };

/**
 * Match MixMap tracks to the current library. Order: remembered manual match (if
 * that rekordbox track still exists), exact portable key, same artist + title with
 * duration ±1 s. A unique hit is matched; several are ambiguous; none is missing
 * (previously matched) or unmatched.
 */
export function matchTracks(
  stored: StoredTrack[],
  library: LibraryTrack[],
  /** portable key → rekordbox id, remembered from manual mapping. */
  manualMatches: ReadonlyMap<string, string>,
): MatchResult[] {
  const byId = new Map(library.map((t) => [t.id, t]));
  const byKey = groupBy(library, portableKey);
  const byName = groupBy(library, nameKey);
  // rekordbox ids claimed by a manual or exact match; the ±1 s fallback must not
  // hand them to a second MixMap track.
  const claimed = new Set<string>();
  for (const s of stored) {
    const manual = manualMatches.get(s.key);
    if (manual !== undefined && byId.has(manual)) claimed.add(manual);
    const exact = byKey.get(s.key);
    if (exact?.length === 1) claimed.add(exact[0].id);
  }
  return stored.map((s): MatchResult => {
    const manual = manualMatches.get(s.key);
    if (manual !== undefined && byId.has(manual)) return { kind: "matched", rekordboxId: manual, trackKey: s.key };

    let candidates = byKey.get(s.key) ?? [];
    if (candidates.length === 0) {
      const [name, seconds] = splitKey(s.key);
      candidates = (byName.get(name) ?? []).filter(
        (t) => Math.abs(Math.round(t.length) - seconds) <= 1 && !claimed.has(t.id),
      );
    }
    if (candidates.length === 1) return { kind: "matched", rekordboxId: candidates[0].id, trackKey: s.key };
    if (candidates.length > 1) {
      // The previously cached match wins if it is among the candidates.
      const cached = candidates.find((c) => c.id === s.rekordboxId);
      if (cached) return { kind: "matched", rekordboxId: cached.id, trackKey: s.key };
      return { candidates: candidates.map((c) => c.id), kind: "ambiguous", trackKey: s.key };
    }
    return { kind: s.rekordboxId ? "missing" : "unmatched", trackKey: s.key };
  });
}

function splitKey(key: string): [string, number] {
  const i = key.lastIndexOf("|");
  return [key.slice(0, i), Number(key.slice(i + 1))];
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const t of items) {
    const k = key(t);
    const list = m.get(k);
    if (list) list.push(t);
    else m.set(k, [t]);
  }
  return m;
}
