// Reading and writing the .mixmap.json exchange data (business/exchange.ts) in mixmap.db.
import {
  type ExportTombstone,
  FORMAT,
  FORMAT_VERSION,
  type ImportMode,
  type MixmapExport,
} from "@/business/exchange";
import { portableKey, type TrackIdentity } from "@/business/matching";
import { emptyExport, mergeData, type MergePlan, type MergeSummary } from "@/business/merge";
import { isLocalSetting } from "@/business/settings";
import type { TombstoneKind } from "@/business/tombstones";
import type { Db, Statement } from "./db";

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
  const [tracks, links, nodes, manualMatches, tombstones, settings] = await Promise.all([
    db.query<{
      artist: string;
      created_at: number;
      duration: number;
      key: string;
      title: string;
      updated_at: number;
    }>("SELECT key, artist, title, duration, created_at, updated_at FROM tracks ORDER BY key"),
    db.query<{
      comment: string;
      created_at: number;
      from_track: string;
      rating: number | null;
      tags: string;
      to_track: string;
      updated_at: number;
    }>("SELECT * FROM links ORDER BY from_track, to_track"),
    db.query<{ created_at: number; track_key: string; updated_at: number; x: number; y: number }>(
      "SELECT * FROM nodes ORDER BY track_key",
    ),
    db.query<{ created_at: number; rekordbox_id: string; track_key: string; updated_at: number }>(
      "SELECT * FROM manual_matches ORDER BY track_key",
    ),
    db.query<{ deleted_at: number; id: string; kind: TombstoneKind }>(
      "SELECT * FROM tombstones ORDER BY kind, id",
    ),
    db.query<{ key: string; updated_at: number; value: string }>(
      "SELECT * FROM settings ORDER BY key",
    ),
  ]);
  return {
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
    nodes: nodes.map((n) => ({
      createdAt: n.created_at,
      trackKey: n.track_key,
      updatedAt: n.updated_at,
      x: n.x,
      y: n.y,
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
    version: FORMAT_VERSION,
  };
}

// ---- Import ------------------------------------------------------------------

const TABLE: Record<TombstoneKind, { cols: string[]; table: string }> = {
  link: { cols: ["from_track", "to_track"], table: "links" },
  manual_match: { cols: ["track_key"], table: "manual_matches" },
  node: { cols: ["track_key"], table: "nodes" },
  track: { cols: ["key"], table: "tracks" },
};

const tombStatement = (t: ExportTombstone): Statement => ({
  params: [t.kind, t.id, t.deletedAt],
  sql: `INSERT INTO tombstones (kind, id, deleted_at) VALUES (?, ?, ?)
        ON CONFLICT (kind, id) DO UPDATE SET deleted_at = MAX(deleted_at, excluded.deleted_at)`,
});

const reviveStatement = (kind: TombstoneKind, id: string): Statement => ({
  params: [kind, id],
  sql: "DELETE FROM tombstones WHERE kind = ? AND id = ?",
});

/** Statements that apply a merge plan (run them in one transaction). */
export function applyPlanStatements(plan: MergePlan): Statement[] {
  const out: Statement[] = [];
  for (const d of plan.deletes) {
    const { cols, table } = TABLE[d.kind];
    out.push(
      {
        params: d.id.split("\u0001"),
        sql: `DELETE FROM ${table} WHERE ${cols.map((c) => `${c} = ?`).join(" AND ")}`,
      },
      tombStatement(d),
    );
  }
  for (const t of plan.tombstones) out.push(tombStatement(t));
  for (const t of plan.tracks) {
    out.push(reviveStatement("track", t.key), {
      params: [t.key, t.artist, t.title, t.duration, t.createdAt, t.updatedAt],
      sql: `INSERT INTO tracks (key, artist, title, duration, rekordbox_id, missing, created_at, updated_at)
            VALUES (?, ?, ?, ?, NULL, 0, ?, ?)
            ON CONFLICT (key) DO UPDATE SET artist = excluded.artist, title = excluded.title,
              duration = excluded.duration, updated_at = excluded.updated_at, created_at = excluded.created_at`,
    });
  }
  for (const l of plan.links) {
    out.push(reviveStatement("link", `${l.from}\u0001${l.to}`), {
      params: [l.from, l.to, l.comment, l.rating, l.tags, l.createdAt, l.updatedAt],
      sql: `INSERT INTO links (from_track, to_track, comment, rating, tags, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (from_track, to_track) DO UPDATE SET comment = excluded.comment,
              rating = excluded.rating, tags = excluded.tags, updated_at = excluded.updated_at, created_at = excluded.created_at`,
    });
  }
  for (const n of plan.nodes) {
    out.push(reviveStatement("node", n.trackKey), {
      params: [n.trackKey, n.x, n.y, n.createdAt, n.updatedAt],
      sql: `INSERT INTO nodes (track_key, x, y, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (track_key) DO UPDATE SET x = excluded.x, y = excluded.y,
              updated_at = excluded.updated_at, created_at = excluded.created_at`,
    });
  }
  for (const m of plan.manualMatches) {
    out.push(reviveStatement("manual_match", m.trackKey), {
      params: [m.trackKey, m.rekordboxId, m.createdAt, m.updatedAt],
      sql: `INSERT INTO manual_matches (track_key, rekordbox_id, created_at, updated_at) VALUES (?, ?, ?, ?)
            ON CONFLICT (track_key) DO UPDATE SET rekordbox_id = excluded.rekordbox_id,
              updated_at = excluded.updated_at, created_at = excluded.created_at`,
    });
  }
  for (const s of plan.settings) {
    out.push({
      params: [s.key, JSON.stringify(s.value), s.updatedAt],
      sql: `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
            ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    });
  }
  return out;
}

/** Statements that empty all synced data; machine-local settings stay. */
export function wipeStatements(): Statement[] {
  return [
    { sql: "DELETE FROM nodes" },
    { sql: "DELETE FROM links" },
    { sql: "DELETE FROM manual_matches" },
    { sql: "DELETE FROM tracks" },
    { sql: "DELETE FROM tombstones" },
    { sql: "DELETE FROM settings WHERE key NOT LIKE 'local.%'" },
  ];
}

/**
 * Reset: delete all mixmap data (links, graph nodes, tracks, manual matches, tombstones,
 * shared settings). Machine-local settings stay. No tombstones are written, so a later
 * sync brings a peer's data back rather than deleting it there. Back up first.
 */
export async function resetData(db: Db): Promise<void> {
  await db.execute(wipeStatements());
}

/**
 * Import a parsed file in one transaction. "merge": last-write-wins per item against
 * what's here. "replace": all synced data is replaced by the file (back up first).
 * Run matching afterwards: imported tracks have no rekordbox id yet.
 */
export async function importData(
  db: Db,
  data: MixmapExport,
  mode: ImportMode,
  library: ReadonlyMap<string, TrackIdentity> = new Map(),
): Promise<MergeSummary> {
  const local = mode === "merge" ? await exportData(db, library) : emptyExport();
  const plan = mergeData(local, data, library);
  await db.execute([...(mode === "replace" ? wipeStatements() : []), ...applyPlanStatements(plan)]);
  return plan.summary;
}
