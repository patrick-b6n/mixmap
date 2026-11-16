// The .mixmap.json exchange format: everything that syncs between machines, with
// timestamps, keyed by portable track key. Used by export/import, backups and
// network sync. Machine-local caches (tracks.rekordbox_id / missing, `local.*`
// settings) are never part of it.
import { portableKey, type TrackIdentity } from "../domain/matching";
import { emptyExport, mergeData, type MergePlan, type MergeSummary } from "../domain/merge";
import type { Db, Statement } from "./db";
import { BOARD_GAP, type TombstoneKind } from "./schema";
import { isLocalSetting } from "./settings";

export const FORMAT = "mixmap";
export const FORMAT_VERSION = 2;

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
/** A track placed on the graph (a card) and its position. */
export type ExportNode = { createdAt: number; trackKey: string; updatedAt: number; x: number; y: number };
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
  exportedAt: number;
  format: typeof FORMAT;
  links: ExportLink[];
  manualMatches: ExportManualMatch[];
  nodes: ExportNode[];
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
  const [tracks, links, nodes, manualMatches, tombstones, settings] = await Promise.all([
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
    db.query<{ created_at: number; track_key: string; updated_at: number; x: number; y: number }>(
      "SELECT * FROM nodes ORDER BY track_key",
    ),
    db.query<{ created_at: number; rekordbox_id: string; track_key: string; updated_at: number }>(
      "SELECT * FROM manual_matches ORDER BY track_key",
    ),
    db.query<{ deleted_at: number; id: string; kind: TombstoneKind }>("SELECT * FROM tombstones ORDER BY kind, id"),
    db.query<{ key: string; updated_at: number; value: string }>("SELECT * FROM settings ORDER BY key"),
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

const p = (n: number) => String(n).padStart(2, "0");

/** `mixmap-2026-11-15-093012.mixmap.json` (local time); `prefix` names what it is. */
export function exportFileName(date = new Date(), prefix = "mixmap"): string {
  return `${prefix}-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(
    date.getMinutes(),
  )}${p(date.getSeconds())}.mixmap.json`;
}

/** Pretty-printed JSON text of an export. */
export const serializeExport = (data: MixmapExport): string => `${JSON.stringify(data, null, 2)}\n`;

// ---- Import ------------------------------------------------------------------

const KINDS: readonly TombstoneKind[] = ["link", "manual_match", "node", "track"];
/** Tombstone kinds of version 1 files, dropped on import (boards no longer exist). */
const V1_BOARD_KINDS = ["board", "board_node"];

function fail(what: string): never {
  throw new Error(`Not a valid .mixmap.json file: ${what}`);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (o: Record<string, unknown>, k: string, where: string): string =>
  typeof o[k] === "string" ? o[k] : fail(`${where}.${k} must be text`);
const num = (o: Record<string, unknown>, k: string, where: string): number =>
  typeof o[k] === "number" && Number.isFinite(o[k]) ? o[k] : fail(`${where}.${k} must be a number`);

function list<T>(o: Record<string, unknown>, k: string, item: (x: Record<string, unknown>, where: string) => T): T[] {
  const v = o[k] ?? [];
  if (!Array.isArray(v)) fail(`${k} must be a list`);
  return v.map((x: unknown, i) => (isObj(x) ? item(x, `${k}[${i}]`) : fail(`${k}[${i}] must be an object`)));
}

const stamps = (o: Record<string, unknown>, w: string) => ({
  createdAt: num(o, "createdAt", w),
  updatedAt: num(o, "updatedAt", w),
});

const node = (o: Record<string, unknown>, w: string): ExportNode => ({
  trackKey: str(o, "trackKey", w),
  x: num(o, "x", w),
  y: num(o, "y", w),
  ...stamps(o, w),
});

/** Parse and check a .mixmap.json file. Throws a readable error for anything else. */
export function parseExport(text: string): MixmapExport {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    fail("the file is not JSON");
  }
  return checkExport(raw);
}

/** Check already-parsed data (a file, or what a sync peer sent). Throws a readable error. */
export function checkExport(raw: unknown): MixmapExport {
  if (!isObj(raw) || raw.format !== FORMAT) fail(`missing format "${FORMAT}"`);
  if (raw.version !== FORMAT_VERSION && raw.version !== 1) {
    fail(`version ${String(raw.version)} is not supported (this app reads versions 1 and ${FORMAT_VERSION})`);
  }
  // Version 1 had boards: their nodes become the one graph.
  const v1 = raw.version === 1;
  const data: MixmapExport = {
    exportedAt: typeof raw.exportedAt === "number" ? raw.exportedAt : 0,
    format: FORMAT,
    links: list(raw, "links", (o, w) => {
      const rating = o.rating ?? null;
      if (rating !== null && !(typeof rating === "number" && Number.isInteger(rating) && rating >= 1 && rating <= 5)) {
        fail(`${w}.rating must be 1–5 or null`);
      }
      const tags: unknown = o.tags ?? [];
      if (!Array.isArray(tags) || !tags.every((t) => typeof t === "string")) fail(`${w}.tags must be a list of text`);
      const from = str(o, "from", w);
      const to = str(o, "to", w);
      if (from === to) fail(`${w} links a track to itself`);
      return {
        comment: typeof o.comment === "string" ? o.comment : "",
        from,
        rating: rating as number | null,
        tags: tags as string[],
        to,
        ...stamps(o, w),
      };
    }),
    manualMatches: list(raw, "manualMatches", (o, w) => ({
      rekordboxId: str(o, "rekordboxId", w),
      targetKey: typeof o.targetKey === "string" ? o.targetKey : null,
      trackKey: str(o, "trackKey", w),
      ...stamps(o, w),
    })),
    nodes: v1
      ? nodesFromBoards(
          list(raw, "boards", (o, w) => ({ id: str(o, "id", w), position: num(o, "position", w), ...stamps(o, w) })),
          list(raw, "boardNodes", (o, w) => ({ boardId: str(o, "boardId", w), ...node(o, w) })),
        )
      : list(raw, "nodes", node),
    settings: list(raw, "settings", (o, w) => ({
      key: str(o, "key", w),
      updatedAt: num(o, "updatedAt", w),
      value: o.value,
    })),
    tombstones: list(raw, "tombstones", (o, w) => {
      const kind = str(o, "kind", w);
      if (!KINDS.includes(kind as TombstoneKind) && !(v1 && V1_BOARD_KINDS.includes(kind))) {
        fail(`${w}.kind "${kind}" is unknown`);
      }
      return { deletedAt: num(o, "deletedAt", w), id: str(o, "id", w), kind: kind as TombstoneKind };
    }).filter((t) => KINDS.includes(t.kind)),
    tracks: list(raw, "tracks", (o, w) => ({
      artist: str(o, "artist", w),
      duration: num(o, "duration", w),
      key: str(o, "key", w),
      title: str(o, "title", w),
      ...stamps(o, w),
    })),
    version: FORMAT_VERSION,
  };
  // Machine-local settings never come from another machine.
  data.settings = data.settings.filter((s) => !isLocalSetting(s.key));
  // Every link and node must point at a track in the file: it is self-contained.
  const keys = new Set(data.tracks.map((t) => t.key));
  for (const l of data.links) if (!keys.has(l.from) || !keys.has(l.to)) fail(`link ${l.from} → ${l.to} has no track`);
  for (const n of data.nodes) if (!keys.has(n.trackKey)) fail(`node ${n.trackKey} has no track`);
  return data;
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Version 1 boards → one graph, like schema migration 2: boards side by side in tab
 * order, each shifted to start at its own top-left; a track on several boards keeps
 * its place on the first. Nodes on unknown boards are dropped.
 */
export function nodesFromBoards(
  boards: { createdAt: number; id: string; position: number }[],
  boardNodes: (ExportNode & { boardId: string })[],
): ExportNode[] {
  const ordered = boards.toSorted((a, b) => a.position - b.position || a.createdAt - b.createdAt || byText(a.id, b.id));
  const out = new Map<string, ExportNode>();
  let dx = 0;
  for (const board of ordered) {
    const mine = boardNodes
      .filter((n) => n.boardId === board.id)
      .toSorted((a, b) => a.createdAt - b.createdAt || byText(a.trackKey, b.trackKey));
    if (mine.length === 0) continue;
    const minX = Math.min(...mine.map((n) => n.x));
    const maxX = Math.max(...mine.map((n) => n.x));
    const minY = Math.min(...mine.map((n) => n.y));
    for (const { boardId: _, ...n } of mine) {
      if (!out.has(n.trackKey)) out.set(n.trackKey, { ...n, x: n.x - minX + dx, y: n.y - minY });
    }
    dx += maxX - minX + BOARD_GAP;
  }
  return [...out.values()];
}

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
      { params: d.id.split("\u0001"), sql: `DELETE FROM ${table} WHERE ${cols.map((c) => `${c} = ?`).join(" AND ")}` },
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

export type ImportMode = "merge" | "replace";

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
