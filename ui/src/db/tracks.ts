import type { Track } from "../api";
import { type LibraryTrack, type MatchResult, matchTracks, portableKey } from "../domain/matching";
import { type Db, now, type Statement } from "./db";

/** A mixmap track row (identity = portable key). */
export type TrackRow = {
  artist: string;
  duration: number;
  key: string;
  missing: boolean;
  rekordboxId: string | null;
  title: string;
};

type RawTrackRow = Omit<TrackRow, "missing" | "rekordboxId"> & { missing: number; rekordbox_id: string | null };

export async function listTracks(db: Db): Promise<TrackRow[]> {
  const rows = await db.query<RawTrackRow>(
    "SELECT key, artist, title, duration, rekordbox_id, missing FROM tracks ORDER BY key",
  );
  return rows.map(({ missing, rekordbox_id, ...r }) => ({ ...r, missing: missing === 1, rekordboxId: rekordbox_id }));
}

/**
 * Statement that makes sure a rekordbox track exists in mixmap.db (e.g. before
 * linking it) and returns its key. Existing rows are left alone except for
 * refreshing the local rekordbox id cache.
 */
export function ensureTrackStatement(t: Track): { key: string; statement: Statement } {
  const key = portableKey(t);
  const ts = now();
  return {
    key,
    statement: {
      params: [key, t.artist, t.title, Math.round(t.length), t.id, ts, ts],
      sql: `INSERT INTO tracks (key, artist, title, duration, rekordbox_id, missing, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 0, ?, ?)
            ON CONFLICT (key) DO UPDATE SET rekordbox_id = excluded.rekordbox_id, missing = 0`,
    },
  };
}

export async function manualMatches(db: Db): Promise<Map<string, string>> {
  const rows = await db.query<{ rekordbox_id: string; track_key: string }>(
    "SELECT track_key, rekordbox_id FROM manual_matches",
  );
  return new Map(rows.map((r) => [r.track_key, r.rekordbox_id]));
}

/** Remember that `trackKey` is `rekordboxId` on this machine (manual mapping). */
export async function setManualMatch(db: Db, trackKey: string, rekordboxId: string): Promise<void> {
  const ts = now();
  await db.execute([
    {
      params: [trackKey, rekordboxId, ts, ts],
      sql: `INSERT INTO manual_matches (track_key, rekordbox_id, created_at, updated_at) VALUES (?, ?, ?, ?)
            ON CONFLICT (track_key) DO UPDATE SET rekordbox_id = excluded.rekordbox_id, updated_at = excluded.updated_at`,
    },
    {
      params: [rekordboxId, trackKey],
      sql: "UPDATE tracks SET rekordbox_id = ?, missing = 0 WHERE key = ?",
    },
  ]);
}

/**
 * Match all mixmap tracks against the current rekordbox library and store the
 * outcome: matched tracks cache their rekordbox id; tracks whose rekordbox track is
 * gone are marked missing (they stay in the graph). Unmatched and ambiguous tracks
 * are returned for the "Unmatched tracks" view.
 */
export async function reconcile(db: Db, library: LibraryTrack[]): Promise<MatchResult[]> {
  const stored = await listTracks(db);
  const results = matchTracks(stored, library, await manualMatches(db));
  const statements: Statement[] = [];
  results.forEach((r, i) => {
    const before = stored[i];
    if (r.kind === "matched" && (before.rekordboxId !== r.rekordboxId || before.missing)) {
      statements.push({
        params: [r.rekordboxId, r.trackKey],
        sql: "UPDATE tracks SET rekordbox_id = ?, missing = 0 WHERE key = ?",
      });
    } else if ((r.kind === "missing" || (r.kind === "ambiguous" && before.rekordboxId)) && !before.missing) {
      // Gone, or the cached id no longer identifies it: flag until resolved.
      statements.push({ params: [r.trackKey], sql: "UPDATE tracks SET missing = 1 WHERE key = ?" });
    }
  });
  if (statements.length) await db.execute(statements);
  return results;
}
