// Import link pairs from a rekordbox playlist or history: every back-to-back pair
// A, B becomes a proposed link A → B.
import { portableKey, type TrackIdentity } from "./matching";

export type ProposedPair<T> = {
  from: T;
  fromKey: string;
  /** How often this transition occurs in the list. */
  occurrences: number;
  to: T;
  toKey: string;
  /** The link already exists (shown, but not created again). */
  exists: boolean;
};

/**
 * Back-to-back pairs of `trackIds` in order, de-duplicated by direction (first
 * occurrence wins the position). Pairs with an unknown track or the same track twice
 * (same portable key) are skipped.
 */
export function proposePairs<T extends TrackIdentity>(
  trackIds: string[],
  library: ReadonlyMap<string, T>,
  links: { from: string; to: string }[],
): ProposedPair<T>[] {
  const existing = new Set(links.map((l) => `${l.from}\u0001${l.to}`));
  const byPair = new Map<string, ProposedPair<T>>();
  for (let i = 0; i + 1 < trackIds.length; i++) {
    const from = library.get(trackIds[i] ?? "");
    const to = library.get(trackIds[i + 1] ?? "");
    if (!from || !to) continue;
    const fromKey = portableKey(from);
    const toKey = portableKey(to);
    if (fromKey === toKey) continue;
    const id = `${fromKey}\u0001${toKey}`;
    const seen = byPair.get(id);
    if (seen) seen.occurrences++;
    else byPair.set(id, { exists: existing.has(id), from, fromKey, occurrences: 1, to, toKey });
  }
  return [...byPair.values()];
}
