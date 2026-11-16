import { describe, expect, it } from "vitest";
import type { Track } from "../api";
import {
  DEFAULT_CONFIG,
  formatBpm,
  formatLength,
  keyLabel,
  nextSort,
  parseConfig,
  searchTracks,
  sortTracks,
  stars,
} from "./trackTable";

const track = (id: string, patch: Partial<Track> = {}): Track => ({
  album: "",
  artist: "",
  artworkPath: null,
  bpm: 0,
  comment: "",
  filePath: "",
  genre: "",
  id,
  key: "",
  length: 0,
  rating: 0,
  title: id,
  ...patch,
});

describe("trackTable", () => {
  it("formats keys and lengths", () => {
    expect(keyLabel("8A")).toBe("8A · Am");
    expect(keyLabel("Db")).toBe("3B · Db");
    expect(keyLabel("weird")).toBe("weird");
    expect(formatLength(353)).toBe("5:53");
    expect(formatLength(59)).toBe("0:59");
    expect(formatBpm(87.99)).toBe("88");
    expect(formatBpm(128)).toBe("128");
    expect(formatBpm(127.56)).toBe("127.6");
    expect(formatBpm(0)).toBe("");
    expect(stars(3)).toBe("★★★");
    expect(stars(-1)).toBe("");
    expect(stars(9)).toBe("★★★★★");
  });

  it("cycles sorting asc → desc → off", () => {
    let s = nextSort(undefined, "bpm");
    expect(s).toEqual({ column: "bpm", desc: false });
    s = nextSort(s, "bpm");
    expect(s).toEqual({ column: "bpm", desc: true });
    expect(nextSort(s, "bpm")).toBeUndefined();
    expect(nextSort(s, "title")).toEqual({ column: "title", desc: false });
  });

  it("sorts stably, numbers naturally, empties last, keys by wheel", () => {
    const ts = [
      track("a", { bpm: 128, key: "9A", title: "Track 10" }),
      track("b", { bpm: 124, key: "8B", title: "Track 9" }),
      track("c", { bpm: 128, key: "8A", title: "" }),
    ];
    expect(sortTracks(ts, { column: "bpm", desc: false }).map((t) => t.id)).toEqual(["b", "a", "c"]);
    expect(sortTracks(ts, { column: "bpm", desc: true }).map((t) => t.id)).toEqual(["a", "c", "b"]);
    expect(sortTracks(ts, { column: "title", desc: false }).map((t) => t.id)).toEqual(["b", "a", "c"]);
    expect(sortTracks(ts, { column: "title", desc: true }).map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(sortTracks(ts, { column: "key", desc: false }).map((t) => t.id)).toEqual(["c", "b", "a"]);
    expect(sortTracks(ts, { column: "links", desc: true }, (id) => (id === "c" ? 3 : 0)).map((t) => t.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(sortTracks(ts, undefined)).toBe(ts);
    const withUnknown = [track("x", { bpm: 0 }), track("y", { bpm: 90 })];
    expect(sortTracks(withUnknown, { column: "bpm", desc: false }).map((t) => t.id)).toEqual(["y", "x"]);
  });

  it("searches all terms across fields, including the key label", () => {
    const ts = [
      track("a", { artist: "ATB", genre: "Trance", key: "8A", title: "Ecstasy" }),
      track("b", { artist: "Caru", comment: "great opener", title: "San Andreas" }),
    ];
    expect(searchTracks(ts, "atb trance").map((t) => t.id)).toEqual(["a"]);
    expect(searchTracks(ts, "OPENER").map((t) => t.id)).toEqual(["b"]);
    expect(searchTracks(ts, "am").map((t) => t.id)).toEqual(["a"]);
    expect(searchTracks(ts, "  ")).toBe(ts);
    expect(searchTracks(ts, "atb opener")).toEqual([]);
  });

  it("restores stored configs defensively", () => {
    expect(parseConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(parseConfig("{oops")).toEqual(DEFAULT_CONFIG);
    const c = parseConfig(
      JSON.stringify({
        columns: [
          { id: "bpm", visible: false, width: 5 },
          { id: "nope", visible: true, width: 100 },
          { id: "bpm", visible: true, width: 100 },
        ],
        sort: { column: "artwork", desc: true },
      }),
    );
    expect(c.columns[0]).toEqual({ id: "bpm", visible: false, width: 30 });
    expect(c.columns).toHaveLength(DEFAULT_CONFIG.columns.length);
    expect(c.sort).toBeUndefined();
    expect(parseConfig(JSON.stringify({ sort: { column: "title", desc: true } })).sort).toEqual({
      column: "title",
      desc: true,
    });
  });
});
