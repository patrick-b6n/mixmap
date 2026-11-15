// The .mixmap.json exchange format: everything that syncs between machines, with
// timestamps, keyed by portable track key. Used by export/import, backups and
// network sync. Machine-local caches (tracks.rekordbox_id / missing, `local.*`
// settings) are never part of it.
import { portableKey, type TrackIdentity } from "../domain/matching";
import type { Db } from "./db";
import type { TombstoneKind } from "./schema";
import { isLocalSetting } from "./settings";

export const FORMAT = "mixmap";
export const FORMAT_VERSION = 1;

export type ExportTrack = {
  artist: string;
  createdAt: number;
  duration: number;
  key: string;
  title: string;
  updatedAt: number;
};
export type ExportLink = {
  comment: string;
  createdAt: number;
  from: string;
  rating: number | null;
  tags: string[];
  to: string;
  updatedAt: number;
};
export type ExportBoard = { createdAt: number; id: string; name: string; position: number; updatedAt: number };
export type ExportBoardNode = {
  boardId: string;
  createdAt: number;
  trackKey: string;
  updatedAt: number;
  x: number;
  y: number;
};
/**
 * A remembered manual match. `rekordboxId` only means something on the machine that
 * made it; `targetKey` (portable key of that rekordbox track at export time) lets
 * another machine find the same track.
 */
export type ExportManualMatch = {
  createdAt: number;
  rekordboxId: string;
  targetKey: string | null;
  trackKey: string;
  updatedAt: number;
};
export type ExportTombstone = { deletedAt: number; id: string; kind: TombstoneKind };
export type ExportSetting = { key: string; updatedAt: number; value: unknown };

export type MixmapExport = {
  boardNodes: ExportBoardNode[];
  boards: ExportBoard[];
  exportedAt: number;
  format: typeof FORMAT;
  links: ExportLink[];
  manualMatches: ExportManualMatch[];
  settings: ExportSetting[];
  tombstones: ExportTombstone[];
  tracks: ExportTrack[];
  version: typeof FORMAT_VERSION;
};

const parseJson = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};

/**
 * Read all syncable data. `library` (rekordbox tracks by id) fills in each manual
 * match's `targetKey`; without it, or when the track is gone, it is null.
 */
export async function exportData(
  db: Db,
  library: ReadonlyMap<string, TrackIdentity> = new Map(),
  exportedAt = Date.now(),
): Promise<MixmapExport> {
  const [tracks, links, boards, boardNodes, manualMatches, tombstones, settings] = await Promise.all([
    db.query<{ artist: string; created_at: number; duration: number; key: string; title: string; updated_at: number }>(
      "SELECT key, artist, title, duration, created_at, updated_at FROM tracks ORDER BY key",
    ),
    db.query<{
      comment: string;
      created_at: number;
      from_track: string;
      rating: number | null;
      tags: string;
      to_track: string;
      updated_at: number;
    }>("SELECT * FROM links ORDER BY from_track, to_track"),
    db.query<{ created_at: number; id: string; name: string; position: number; updated_at: number }>(
      "SELECT * FROM boards ORDER BY position, id",
    ),
    db.query<{ board_id: string; created_at: number; track_key: string; updated_at: number; x: number; y: number }>(
      "SELECT * FROM board_nodes ORDER BY board_id, track_key",
    ),
    db.query<{ created_at: number; rekordbox_id: string; track_key: string; updated_at: number }>(
      "SELECT * FROM manual_matches ORDER BY track_key",
    ),
    db.query<{ deleted_at: number; id: string; kind: TombstoneKind }>("SELECT * FROM tombstones ORDER BY kind, id"),
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
    format: FORMAT,
    links: links.map((l) => {
      const tags = parseJson(l.tags);
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
    manualMatches: manualMatches.map((m) => {
      const target = library.get(m.rekordbox_id);
      return {
        createdAt: m.created_at,
        rekordboxId: m.rekordbox_id,
        targetKey: target ? portableKey(target) : null,
        trackKey: m.track_key,
        updatedAt: m.updated_at,
      };
    }),
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
    version: FORMAT_VERSION,
  };
}

const p = (n: number) => String(n).padStart(2, "0");

/** `mixmap-2026-11-15-093012.mixmap.json` (local time). */
export function exportFileName(date = new Date()): string {
  return `mixmap-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(
    date.getMinutes(),
  )}${p(date.getSeconds())}.mixmap.json`;
}

/** Pretty-printed JSON text of an export. */
export const serializeExport = (data: MixmapExport): string => `${JSON.stringify(data, null, 2)}\n`;
