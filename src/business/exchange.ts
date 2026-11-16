// The .mixmap.json exchange format: everything that syncs between machines, with
// timestamps, keyed by portable track key. Used by export/import, backups and
// network sync. Machine-local caches (tracks.rekordbox_id / missing, `local.*`
// settings) are never part of it.
import { ExchangeError, type ExchangeErrorCode } from "./errors";
import { isLocalSetting } from "./settings";
import { BOARD_GAP, type TombstoneKind } from "./tombstones";

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
export type ExportNode = {
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

const p = (n: number) => String(n).padStart(2, "0");

/** `mixmap-2026-11-15-093012.mixmap.json` (local time); `prefix` names what it is. */
export function exportFileName(date = new Date(), prefix = "mixmap"): string {
  return `${prefix}-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(
    date.getMinutes(),
  )}${p(date.getSeconds())}.mixmap.json`;
}

/** Pretty-printed JSON text of an export. */
export const serializeExport = (data: MixmapExport): string => `${JSON.stringify(data, null, 2)}\n`;

/** "merge": last-write-wins per item; "replace": the file replaces all synced data. */
export type ImportMode = "merge" | "replace";

// ---- Import ------------------------------------------------------------------

const KINDS: readonly TombstoneKind[] = ["link", "manual_match", "node", "track"];
/** Tombstone kinds of version 1 files, dropped on import (boards no longer exist). */
const V1_BOARD_KINDS = ["board", "board_node"];

function fail(code: ExchangeErrorCode, params: Record<string, string> = {}): never {
  throw new ExchangeError(code, params);
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (o: Record<string, unknown>, k: string, where: string): string =>
  typeof o[k] === "string" ? o[k] : fail("not_text", { field: `${where}.${k}` });
const num = (o: Record<string, unknown>, k: string, where: string): number =>
  typeof o[k] === "number" && Number.isFinite(o[k])
    ? o[k]
    : fail("not_number", { field: `${where}.${k}` });

function list<T>(
  o: Record<string, unknown>,
  k: string,
  item: (x: Record<string, unknown>, where: string) => T,
): T[] {
  const v = o[k] ?? [];
  if (!Array.isArray(v)) fail("not_list", { field: k });
  return v.map((x: unknown, i) =>
    isObj(x) ? item(x, `${k}[${i}]`) : fail("not_object", { field: `${k}[${i}]` }),
  );
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

/** Parse and check a .mixmap.json file. Throws an {@link ExchangeError} for anything else. */
export function parseExport(text: string): MixmapExport {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    fail("not_json");
  }
  return checkExport(raw);
}

/** Check already-parsed data (a file, or what a sync peer sent); throws an {@link ExchangeError}. */
export function checkExport(raw: unknown): MixmapExport {
  if (!isObj(raw) || raw.format !== FORMAT) fail("wrong_format");
  if (raw.version !== FORMAT_VERSION && raw.version !== 1) {
    fail("unsupported_version", { version: String(raw.version) });
  }
  // Version 1 had boards: their nodes become the one graph.
  const v1 = raw.version === 1;
  const data: MixmapExport = {
    exportedAt: typeof raw.exportedAt === "number" ? raw.exportedAt : 0,
    format: FORMAT,
    links: list(raw, "links", (o, w) => {
      const rating = o.rating ?? null;
      if (
        rating !== null &&
        !(typeof rating === "number" && Number.isInteger(rating) && rating >= 1 && rating <= 5)
      ) {
        fail("bad_rating", { field: w });
      }
      const tags: unknown = o.tags ?? [];
      if (!Array.isArray(tags) || !tags.every((t) => typeof t === "string"))
        fail("bad_tags", { field: w });
      const from = str(o, "from", w);
      const to = str(o, "to", w);
      if (from === to) fail("self_link", { field: w });
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
          list(raw, "boards", (o, w) => ({
            id: str(o, "id", w),
            position: num(o, "position", w),
            ...stamps(o, w),
          })),
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
        fail("unknown_kind", { field: w, kind });
      }
      return {
        deletedAt: num(o, "deletedAt", w),
        id: str(o, "id", w),
        kind: kind as TombstoneKind,
      };
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
  for (const l of data.links)
    if (!keys.has(l.from) || !keys.has(l.to))
      fail("link_without_track", { from: l.from, to: l.to });
  for (const n of data.nodes)
    if (!keys.has(n.trackKey)) fail("node_without_track", { track: n.trackKey });
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
  const ordered = boards.toSorted(
    (a, b) => a.position - b.position || a.createdAt - b.createdAt || byText(a.id, b.id),
  );
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
