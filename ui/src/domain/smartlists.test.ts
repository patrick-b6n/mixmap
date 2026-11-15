import { describe, expect, it } from "vitest";
import type { Playlist } from "../api";
import { track } from "../db/testing";
import { evaluate, fillSmartPlaylists, parseSmartList, unsupported } from "./smartlists";

// Real rule XML from rekordbox 7.2.19 ("Untitled Intelligent List").
const REAL =
  '<NODE Id="897199865" LogicalOperator="2" AutomaticUpdate="0"><CONDITION PropertyName="artist" Operator="8" ValueUnit="" ValueLeft="REAPER" ValueRight=""/><CONDITION PropertyName="name" Operator="8" ValueUnit="" ValueLeft="REAPER" ValueRight=""/></NODE>';

const lib = [
  { ...track("1", "Rusko, Netsky", "Everyday (REAPER Bootleg)"), genre: "Drum & Bass" },
  { ...track("2", "Crazy Frog", "Axel F (REAPER Bootleg)"), genre: "Drum & Bass" },
  { ...track("3", "REAPER", "Some Original"), genre: "Techno" },
  { ...track("4", "Estelle", "American Boy (STRIPES Edit)"), filePath: "C:\\Music\\estelle.flac", genre: "House" },
];

const cond = (property: string, operator: number, value: string) =>
  `<CONDITION PropertyName="${property}" Operator="${operator}" ValueUnit="" ValueLeft="${value}" ValueRight=""/>`;
const node = (op: 1 | 2, ...c: string[]) =>
  `<NODE Id="1" LogicalOperator="${op}" AutomaticUpdate="0">${c.join("")}</NODE>`;

const run = (xml: string) => evaluate(parseSmartList(xml)!, lib);
const p = (id: string, smartList: string | null): Playlist => ({
  id,
  kind: "smart",
  name: id,
  parentId: null,
  seq: 0,
  smartList,
  trackIds: [],
});

describe("smart playlists", () => {
  it("parses rekordbox's rule XML", () => {
    expect(parseSmartList(REAL)).toEqual({
      all: false,
      conditions: [
        { operator: 8, property: "artist", unit: "", valueLeft: "REAPER", valueRight: "" },
        { operator: 8, property: "name", unit: "", valueLeft: "REAPER", valueRight: "" },
      ],
    });
    expect(parseSmartList("garbage")).toBeUndefined();
  });

  it("evaluates the real list: artist or title contains REAPER", () => {
    expect(evaluate(parseSmartList(REAL)!, lib)).toEqual(["1", "2", "3"]);
  });

  it("supports all and any, and the text operators", () => {
    expect(run(node(1, cond("genre", 8, "drum"), cond("name", 8, "axel")))).toEqual(["2"]);
    expect(run(node(1, cond("genre", 1, "house")))).toEqual(["4"]);
    expect(run(node(1, cond("genre", 2, "Drum &amp; Bass")))).toEqual(["3", "4"]);
    expect(run(node(1, cond("name", 9, "reaper")))).toEqual(["3", "4"]);
    expect(run(node(1, cond("artist", 10, "rusko")))).toEqual(["1"]);
    expect(run(node(1, cond("name", 11, "edit)")))).toEqual(["4"]);
    expect(run(node(1, cond("fileName", 8, ".flac")))).toEqual(["4"]);
    expect(run(node(2))).toEqual([]);
  });

  it("names rules it can't evaluate yet", () => {
    const xml = node(1, cond("bpm", 5, "170"), cond("genre", 8, "x"), cond("myTag", 1, "3"), cond("name", 6, "x"));
    expect(unsupported(parseSmartList(xml)!)).toEqual(["bpm", "myTag", "name"]);
  });

  it("fills smart playlists, leaving unsupported ones empty with a note", () => {
    const [ok, bad, none] = fillSmartPlaylists(
      [p("a", REAL), p("b", node(1, cond("rating", 3, "3"))), p("c", null)],
      lib,
    );
    expect(ok.trackIds).toEqual(["1", "2", "3"]);
    expect(bad.trackIds).toEqual([]);
    expect(bad.smartNote).toContain("rating");
    expect(none).toEqual(p("c", null));
  });
});
