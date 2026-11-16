// Snapshots of databases from before the current schema, taken before a migration
// that changes data in a way that can't be undone (version 1 → 2 merges boards).
import type { Db } from "./db";
import { isLocalSetting } from "./settings";

const parseJson = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};

/**
 * A schema-version-1 database as a version 1 `.mixmap.json` (boards and all), so the
 * data from before the upgrade can still be read: this app imports it as one graph,
 * an older mixmap restores the boards. Manual matches keep their rekordbox id only.
 */
export async function exportVersion1(db: Db, exportedAt = Date.now()): Promise<unknown> {
  const [tracks, links, boards, boardNodes, manualMatches, tombstones, settings] = await Promise.all([
    db.query<Record<string, number | string>>("SELECT * FROM tracks ORDER BY key"),
    db.query<Record<string, number | string | null>>("SELECT * FROM links ORDER BY from_track, to_track"),
    db.query<Record<string, number | string>>("SELECT * FROM boards ORDER BY position, id"),
    db.query<Record<string, number | string>>("SELECT * FROM board_nodes ORDER BY board_id, track_key"),
    db.query<Record<string, number | string>>("SELECT * FROM manual_matches ORDER BY track_key"),
    db.query<Record<string, number | string>>("SELECT * FROM tombstones ORDER BY kind, id"),
    db.query<{ key: string; updated_at: number; value: string }>("SELECT * FROM settings ORDER BY key"),
  ]);
  return {
    boardNodes: boardNodes.map((n) => ({
      boardId: n.board_id,
      createdAt: n.created_at,
      trackKey: n.track_key,
      updatedAt: n.updated_at,
      x: n.x,
      y: n.y,
    })),
    boards: boards.map((b) => ({
      createdAt: b.created_at,
      id: b.id,
      name: b.name,
      position: b.position,
      updatedAt: b.updated_at,
    })),
    exportedAt,
    format: "mixmap",
    links: links.map((l) => {
      const tags = parseJson(String(l.tags));
      return {
        comment: l.comment,
        createdAt: l.created_at,
        from: l.from_track,
        rating: l.rating,
        tags: Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string") : [],
        to: l.to_track,
        updatedAt: l.updated_at,
      };
    }),
    manualMatches: manualMatches.map((m) => ({
      createdAt: m.created_at,
      rekordboxId: m.rekordbox_id,
      targetKey: null,
      trackKey: m.track_key,
      updatedAt: m.updated_at,
    })),
    settings: settings
      .filter((s) => !isLocalSetting(s.key))
      .map((s) => ({ key: s.key, updatedAt: s.updated_at, value: parseJson(s.value) })),
    tombstones: tombstones.map((t) => ({ deletedAt: t.deleted_at, id: t.id, kind: t.kind })),
    tracks: tracks.map((t) => ({
      artist: t.artist,
      createdAt: t.created_at,
      duration: t.duration,
      key: t.key,
      title: t.title,
      updatedAt: t.updated_at,
    })),
    version: 1,
  };
}
