// Candidate search for manually mapping a mixmap track to a rekordbox track.
import { normalize } from "./matching";

type Target = { artist: string; duration: number; title: string };
type Candidate = { album?: string; artist: string; id: string; length: number; title: string };

const words = (s: string) => new Set(normalize(s).split(" ").filter(Boolean));

/** 0…1: share of the target's artist/title words found in the candidate, minus a small duration penalty. */
export function similarity(target: Target, c: Candidate): number {
  const want = words(`${target.artist} ${target.title}`);
  if (want.size === 0) return 0;
  const have = words(`${c.artist} ${c.title}`);
  let shared = 0;
  for (const w of want) if (have.has(w)) shared++;
  const seconds = Math.abs(Math.round(c.length) - target.duration);
  return shared / want.size - Math.min(seconds, 60) / 600;
}

/**
 * rekordbox tracks to offer for `target`, best first. With a query, only tracks where
 * every query word starts a word of the artist, title or album; without one, tracks that share at
 * least one word with the target.
 */
export function rankCandidates<C extends Candidate>(target: Target, library: C[], query: string, limit = 50): C[] {
  const q = [...words(query)];
  const scored = library.flatMap((c) => {
    if (q.length > 0) {
      const hay = [...words(`${c.artist} ${c.title} ${c.album ?? ""}`)];
      if (!q.every((w) => hay.some((h) => h.startsWith(w)))) return [];
    }
    const score = similarity(target, c);
    if (q.length === 0 && score <= 0) return [];
    return [{ c, score }];
  });
  return scored
    .toSorted((a, b) => b.score - a.score || a.c.title.localeCompare(b.c.title))
    .slice(0, limit)
    .map((s) => s.c);
}
