// Display logic of the track analysis strip: which grid lines and time ticks fit, loop
// lengths, and the layers a user can switch on and off.
import type { Beat, Cue } from "./model";

export const ANALYSIS_LAYERS = [
  "waveform",
  "hotCues",
  "memoryCues",
  "loops",
  "beatGrid",
  "phrases",
  "timeAxis",
  "length",
] as const;

export type AnalysisLayer = (typeof ANALYSIS_LAYERS)[number];

export type AnalysisLayers = Record<AnalysisLayer, boolean>;

export const DEFAULT_LAYERS: AnalysisLayers = Object.fromEntries(
  ANALYSIS_LAYERS.map((l) => [l, true]),
) as AnalysisLayers;

/** Stored layers (JSON); unknown or broken values fall back to the defaults. */
export function parseLayers(raw: string | null): AnalysisLayers {
  let stored: Record<string, unknown> = {};
  try {
    const v: unknown = raw ? JSON.parse(raw) : {};
    if (v && typeof v === "object") stored = v as Record<string, unknown>;
  } catch {
    // Broken JSON: defaults.
  }
  return Object.fromEntries(
    ANALYSIS_LAYERS.map((l) => [l, typeof stored[l] === "boolean" ? stored[l] : DEFAULT_LAYERS[l]]),
  ) as AnalysisLayers;
}

/** Bars per strong grid line (a typical phrase). */
const BARS_PER_STRONG = 16;

/**
 * Grid lines for the strip: one per bar (on the downbeats), a strong one every 16 bars.
 * A level is left out when its lines would be closer than `minGapPx`.
 */
export function barLines(
  beats: Beat[],
  durationMs: number,
  widthPx: number,
  minGapPx = 4,
): { strong: boolean; timeMs: number }[] {
  const downbeats = beats.filter((b) => b.barPosition === 1);
  const first = downbeats[0];
  const last = downbeats.at(-1);
  if (!first || !last || downbeats.length < 2 || durationMs <= 0 || widthPx <= 0) return [];
  const barPx = ((last.timeMs - first.timeMs) / (downbeats.length - 1) / durationMs) * widthPx;
  const showBars = barPx >= minGapPx;
  const showStrong = barPx * BARS_PER_STRONG >= minGapPx;
  return downbeats.flatMap((b, i) => {
    const strong = i % BARS_PER_STRONG === 0;
    return (strong ? showStrong : showBars) ? [{ strong, timeMs: b.timeMs }] : [];
  });
}

const TICK_STEPS_MS = [15_000, 30_000, 60_000, 120_000, 300_000, 600_000];

/** Time axis ticks (ms, after 0) at the finest step that keeps labels `minGapPx` apart. */
export function timeTicks(durationMs: number, widthPx: number, minGapPx = 48): number[] {
  if (durationMs <= 0 || widthPx <= 0) return [];
  const step = TICK_STEPS_MS.find((s) => (s / durationMs) * widthPx >= minGapPx);
  if (!step) return [];
  const ticks: number[] = [];
  for (let t = step; t < durationMs; t += step) ticks.push(t);
  return ticks;
}

/** 83_400 → "1:23". */
export function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Loop length in beats at `bpm`, rounded to 1/4 beat; null for point cues or no BPM. */
export function loopBeats(cue: Cue, bpm: number): number | null {
  if (cue.endMs === null || bpm <= 0) return null;
  const beats = (cue.endMs - cue.startMs) / (60_000 / bpm);
  return Math.round(beats * 4) / 4;
}

/** Strip length: the track length, or the analysis when it reaches further. */
export function stripDurationMs(lengthSeconds: number, beats: Beat[]): number {
  return Math.max(lengthSeconds * 1000, beats.at(-1)?.timeMs ?? 0);
}
