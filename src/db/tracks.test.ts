import { beforeEach, describe, expect, it } from "vitest";
import type { Track } from "../api";
import { portableKey } from "../domain/matching";
import { testDb } from "./testing";
import { ensureTrackStatement, listTracks, reconcile, setManualMatch } from "./tracks";

const track = (id: string, artist: string, title: string, length: number): Track => ({
  album: "",
  artist,
  artworkPath: null,
  bpm: 0,
  comment: "",
  filePath: "",
  genre: "",
  id,
  key: "",
  length,
  rating: 0,
  title,
});

describe("tracks", () => {
  let db: Awaited<ReturnType<typeof testDb>>;
  const a = track("rb1", "ATB", "Ecstasy", 353);
  const b = track("rb2", "Caru", "San Andreas", 197);

  beforeEach(async () => {
    db = await testDb();
    await db.execute([ensureTrackStatement(a).statement, ensureTrackStatement(b).statement]);
  });

  it("stores tracks by portable key, once", async () => {
    await db.execute([ensureTrackStatement({ ...a, artist: "atb", id: "rb9" }).statement]);
    const rows = await listTracks(db);
    expect(rows.map((r) => [r.key, r.rekordboxId])).toEqual([
      [portableKey(a), "rb9"],
      [portableKey(b), "rb2"],
    ]);
  });

  it("marks tracks gone from rekordbox as missing and clears it when they return", async () => {
    let results = await reconcile(db, [a]);
    expect(results.map((r) => r.kind)).toEqual(["matched", "missing"]);
    expect((await listTracks(db)).map((r) => r.missing)).toEqual([false, true]);

    // Back on another rekordbox id (e.g. re-imported): matched again, cache updated.
    results = await reconcile(db, [a, { ...b, id: "rb7" }]);
    expect(results.map((r) => r.kind)).toEqual(["matched", "matched"]);
    expect((await listTracks(db)).map((r) => [r.missing, r.rekordboxId])).toEqual([
      [false, "rb1"],
      [false, "rb7"],
    ]);
  });

  it("remembers manual matches for ambiguous tracks", async () => {
    const dup = { ...b, id: "rb3" };
    await db.execute([{ params: [portableKey(b)], sql: "UPDATE tracks SET rekordbox_id = NULL WHERE key = ?" }]);
    expect((await reconcile(db, [a, b, dup])).map((r) => r.kind)).toEqual(["matched", "ambiguous"]);
    await setManualMatch(db, portableKey(b), "rb3");
    const results = await reconcile(db, [a, b, dup]);
    expect(results[1]).toEqual({ kind: "matched", rekordboxId: "rb3", trackKey: portableKey(b) });
  });
});
