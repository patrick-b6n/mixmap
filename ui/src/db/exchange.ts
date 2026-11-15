// The .mixmap.json exchange format: everything that syncs between machines, with
// timestamps, keyed by portable track key. Used by export/import, backups and
// network sync. Machine-local caches (tracks.rekordbox_id / missing, `local.*`
// settings) are never part of it.
import { portableKey, type TrackIdentity } from "../domain/matching";
import { emptyExport, mergeData, type MergePlan, type MergeSummary } from "../domain/merge";
import type { Db, Statement } from "./db";
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

/** `mixmap-2026-11-15-093012.mixmap.json` (local time); `prefix` names what it is. */
export function exportFileName(date = new Date(), prefix = "mixmap"): string {
  return `${prefix}-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(
    date.getMinutes(),
  )}${p(date.getSeconds())}.mixmap.json`;
}

/** Pretty-printed JSON text of an export. */
export const serializeExport = (data: MixmapExport): string => `${JSON.stringify(data, null, 2)}\n`;

// ---- Import ------------------------------------------------------------------

const KINDS: readonly TombstoneKind[] = ["board", "board_node", "link", "manual_match", "track"];

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
  if (raw.version !== FORMAT_VERSION) {
    fail(`version ${String(raw.version)} is not supported (this app reads version ${FORMAT_VERSION})`);
  }
  const data: MixmapExport = {
    boardNodes: list(raw, "boardNodes", (o, w) => ({
      boardId: str(o, "boardId", w),
      trackKey: str(o, "trackKey", w),
      x: num(o, "x", w),
      y: num(o, "y", w),
      ...stamps(o, w),
    })),
    boards: list(raw, "boards", (o, w) => ({
      id: str(o, "id", w),
      name: str(o, "name", w),
      position: num(o, "position", w),
      ...stamps(o, w),
    })),
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
    settings: list(raw, "settings", (o, w) => ({
      key: str(o, "key", w),
      updatedAt: num(o, "updatedAt", w),
      value: o.value,
    })),
    tombstones: list(raw, "tombstones", (o, w) => {
      const kind = str(o, "kind", w);
      if (!KINDS.includes(kind as TombstoneKind)) fail(`${w}.kind "${kind}" is unknown`);
      return { deletedAt: num(o, "deletedAt", w), id: str(o, "id", w), kind: kind as TombstoneKind };
    }),
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
  // Every link and node must point at a track (and board) in the file: it is self-contained.
  const keys = new Set(data.tracks.map((t) => t.key));
  for (const l of data.links) if (!keys.has(l.from) || !keys.has(l.to)) fail(`link ${l.from} → ${l.to} has no track`);
  const boardIds = new Set(data.boards.map((b) => b.id));
  for (const n of data.boardNodes) {
    if (!keys.has(n.trackKey)) fail(`board node ${n.trackKey} has no track`);
    if (!boardIds.has(n.boardId)) fail(`board node on unknown board ${n.boardId}`);
  }
  return data;
}

const TABLE: Record<TombstoneKind, { cols: string[]; table: string }> = {
  board: { cols: ["id"], table: "boards" },
  board_node: { cols: ["board_id", "track_key"], table: "board_nodes" },
  link: { cols: ["from_track", "to_track"], table: "links" },
  manual_match: { cols: ["track_key"], table: "manual_matches" },
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
  for (const b of plan.boards) {
    out.push(reviveStatement("board", b.id), {
      params: [b.id, b.name, b.position, b.createdAt, b.updatedAt],
      sql: `INSERT INTO boards (id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET name = excluded.name, position = excluded.position,
              updated_at = excluded.updated_at, created_at = excluded.created_at`,
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
  for (const n of plan.boardNodes) {
    out.push(reviveStatement("board_node", `${n.boardId}\u0001${n.trackKey}`), {
      params: [n.boardId, n.trackKey, n.x, n.y, n.createdAt, n.updatedAt],
      sql: `INSERT INTO board_nodes (board_id, track_key, x, y, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (board_id, track_key) DO UPDATE SET x = excluded.x, y = excluded.y,
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
    { sql: "DELETE FROM board_nodes" },
    { sql: "DELETE FROM links" },
    { sql: "DELETE FROM boards" },
    { sql: "DELETE FROM manual_matches" },
    { sql: "DELETE FROM tracks" },
    { sql: "DELETE FROM tombstones" },
    { sql: "DELETE FROM settings WHERE key NOT LIKE 'local.%'" },
  ];
}

/**
 * Reset: delete all mixmap data (links, boards, tracks, manual matches, tombstones,
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
