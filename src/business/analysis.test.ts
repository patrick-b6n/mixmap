import { describe, expect, it } from "vitest";
import {
  barLines,
  DEFAULT_LAYERS,
  formatTime,
  loopBeats,
  parseLayers,
  stripDurationMs,
  timeTicks,
} from "./analysis";
import type { Beat, Cue } from "./model";

/** `bars` bars of 4 beats, 500 ms per beat (120 BPM), from 0. */
const grid = (bars: number): Beat[] =>
  Array.from({ length: bars * 4 }, (_, i) => ({ barPosition: (i % 4) + 1, timeMs: i * 500 }));

const cue = (startMs: number, endMs: number | null): Cue => ({
  color: null,
  comment: "",
  endMs,
  hotCue: null,
  startMs,
});

describe("barLines", () => {
  it("draws every bar with a strong line every 16 bars when there is room", () => {
    // 32 bars of 2 s = 64 s on 640 px: 20 px per bar.
    const lines = barLines(grid(32), 64_000, 640);
    expect(lines).toHaveLength(32);
    expect(lines.filter((l) => l.strong).map((l) => l.timeMs)).toEqual([0, 32_000]);
  });

  it("keeps only the strong lines when bars would be too dense", () => {
    // 3 px per bar, 48 px per 16 bars.
    const lines = barLines(grid(32), 64_000, 96);
    expect(lines).toEqual([
      { strong: true, timeMs: 0 },
      { strong: true, timeMs: 32_000 },
    ]);
  });

  it("draws nothing when even the strong lines don't fit or there is no grid", () => {
    expect(barLines(grid(32), 64_000, 5)).toEqual([]);
    expect(barLines([], 64_000, 640)).toEqual([]);
    expect(barLines(grid(32), 0, 640)).toEqual([]);
  });
});

describe("timeTicks", () => {
  it("picks the finest step that keeps labels apart", () => {
    // 6 min on 960 px: 15 s = 40 px is too tight, 30 s = 80 px fits.
    expect(timeTicks(360_000, 960).slice(0, 3)).toEqual([30_000, 60_000, 90_000]);
    expect(timeTicks(360_000, 960)).toHaveLength(11);
    // Narrow: 2 min steps.
    expect(timeTicks(360_000, 160)).toEqual([120_000, 240_000]);
  });

  it("gives nothing without room or length", () => {
    expect(timeTicks(360_000, 0)).toEqual([]);
    expect(timeTicks(0, 960)).toEqual([]);
  });
});

describe("formatting", () => {
  it("formats times as m:ss", () => {
    expect(formatTime(83_400)).toBe("1:23");
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(-5)).toBe("0:00");
  });

  it("gives loop lengths in beats", () => {
    // The fixture's 16-beat loop at 142 BPM.
    expect(loopBeats(cue(229_858, 236_618), 142)).toBe(16);
    expect(loopBeats(cue(0, 250), 120)).toBe(0.5);
    expect(loopBeats(cue(1000, null), 120)).toBeNull();
    expect(loopBeats(cue(0, 1000), 0)).toBeNull();
  });

  it("uses the longer of track length and beat grid", () => {
    expect(stripDurationMs(10, grid(1))).toBe(10_000);
    expect(stripDurationMs(1, grid(2))).toBe(3500);
    expect(stripDurationMs(5, [])).toBe(5000);
  });
});

describe("parseLayers", () => {
  it("keeps stored booleans and defaults the rest", () => {
    expect(parseLayers(JSON.stringify({ beatGrid: false, nope: true, phrases: "x" }))).toEqual({
      ...DEFAULT_LAYERS,
      beatGrid: false,
    });
  });

  it("falls back to defaults for missing or broken data", () => {
    expect(parseLayers(null)).toEqual(DEFAULT_LAYERS);
    expect(parseLayers("{")).toEqual(DEFAULT_LAYERS);
    expect(parseLayers("[1]")).toEqual(DEFAULT_LAYERS);
  });
});
