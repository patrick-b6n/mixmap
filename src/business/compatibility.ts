// Harmonic and tempo compatibility between two tracks ("compatible with selected").
import { type Key, parseKey } from "./keys";

/** Camelot same key, ±1 on the wheel (same mode), or the relative major/minor. */
export function keysCompatible(a: Key, b: Key): boolean {
  if (a.minor === b.minor) {
    const d = Math.abs(a.num - b.num);
    return d === 0 || d === 1 || d === 11;
  }
  return a.num === b.num;
}

/**
 * Whether `bpm` is within `tolerance` percent of `reference`. With `halfDouble`, half and
 * double the reference tempo also count (e.g. 87 ↔ 174).
 */
export function bpmCompatible(
  reference: number,
  bpm: number,
  tolerance: number,
  halfDouble: boolean,
): boolean {
  const near = (r: number) => Math.abs(bpm - r) <= (r * tolerance) / 100 + 1e-9;
  return near(reference) || (halfDouble && (near(reference / 2) || near(reference * 2)));
}

export type CompatibilityRule = {
  /** BPM tolerance in percent (default 6). */
  bpmTolerance: number;
  halfDouble: boolean;
  /** The selected track. Unknown key / BPM (0) on it means "no constraint" for that part. */
  reference: { bpm: number; key: string };
};

export const DEFAULT_BPM_TOLERANCE = 6;

/** A track is compatible when both its key and its BPM fit the reference. Unknown values don't fit. */
export function compatible(
  rule: CompatibilityRule,
  track: { bpm?: number; key?: string },
): boolean {
  const refKey = parseKey(rule.reference.key);
  if (refKey) {
    const k = track.key ? parseKey(track.key) : undefined;
    if (!k || !keysCompatible(refKey, k)) return false;
  }
  if (rule.reference.bpm > 0) {
    if (!track.bpm || track.bpm <= 0) return false;
    if (!bpmCompatible(rule.reference.bpm, track.bpm, rule.bpmTolerance, rule.halfDouble))
      return false;
  }
  return true;
}
