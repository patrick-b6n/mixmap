// Path-finding: the shortest ways to get from one track to another through links
// (A → B means "I can mix A into B"; links are directed and global).
import type { Link } from "../db/links";

/** A path as track keys, start first; `rating` is the sum of its links' ratings. */
export type TrackPath = { keys: string[]; rating: number };

/**
 * All shortest paths from `from` to `to` (fewest links), at most `limit`, best rated
 * first (unrated links count 0), then alphabetically. Empty when there is none;
 * `[[from]]` when from === to.
 */
export function shortestPaths(
  links: Pick<Link, "from" | "rating" | "to">[],
  from: string,
  to: string,
  limit = 5,
): TrackPath[] {
  if (from === to) return [{ keys: [from], rating: 0 }];
  const out = new Map<string, Pick<Link, "rating" | "to">[]>();
  for (const l of links) {
    const list = out.get(l.from);
    if (list) list.push(l);
    else out.set(l.from, [l]);
  }
  // BFS layer by layer, remembering every predecessor on a shortest route.
  const dist = new Map<string, number>([[from, 0]]);
  const preds = new Map<string, { key: string; rating: number }[]>();
  let layer = [from];
  let found = false;
  for (let d = 1; layer.length > 0 && !found; d++) {
    const next: string[] = [];
    for (const k of layer) {
      for (const l of out.get(k) ?? []) {
        const seen = dist.get(l.to);
        if (seen === undefined) {
          dist.set(l.to, d);
          next.push(l.to);
        }
        if (dist.get(l.to) === d) {
          const p = preds.get(l.to) ?? [];
          p.push({ key: k, rating: l.rating ?? 0 });
          preds.set(l.to, p);
        }
        if (l.to === to) found = true;
      }
    }
    layer = next;
  }
  if (!found) return [];
  // Walk back from the target over all shortest predecessors (bounded).
  const paths: TrackPath[] = [];
  const cap = Math.max(limit * 20, 100);
  const walk = (key: string, suffix: string[], rating: number) => {
    if (paths.length >= cap) return;
    if (key === from) {
      paths.push({ keys: [from, ...suffix], rating });
      return;
    }
    for (const p of preds.get(key) ?? []) walk(p.key, [key, ...suffix], rating + p.rating);
  };
  walk(to, [], 0);
  return paths
    .toSorted((a, b) => b.rating - a.rating || a.keys.join("\u0001").localeCompare(b.keys.join("\u0001")))
    .slice(0, limit);
}

/** Edge ids (`from\u0001to`) along a path. */
export function pathEdges(keys: string[]): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i + 1 < keys.length; i++) s.add(`${keys[i]}\u0001${keys[i + 1]}`);
  return s;
}
