import type { Track } from "./model";
import { camelot, musical, parseKey } from "./keys";

export type ColumnId =
  | "album"
  | "artist"
  | "artwork"
  | "bpm"
  | "comment"
  | "genre"
  | "key"
  | "length"
  | "links"
  | "rating"
  | "title";

export type ColumnDef = {
  defaultWidth: number;
  id: ColumnId;
  /** Sortable columns have a sort value. */
  sortable: boolean;
};

export const COLUMNS: ColumnDef[] = [
  { defaultWidth: 36, id: "artwork", sortable: false },
  { defaultWidth: 240, id: "title", sortable: true },
  { defaultWidth: 180, id: "artist", sortable: true },
  { defaultWidth: 150, id: "album", sortable: true },
  { defaultWidth: 110, id: "genre", sortable: true },
  { defaultWidth: 64, id: "bpm", sortable: true },
  { defaultWidth: 90, id: "key", sortable: true },
  { defaultWidth: 76, id: "rating", sortable: true },
  { defaultWidth: 60, id: "length", sortable: true },
  { defaultWidth: 56, id: "links", sortable: true },
  { defaultWidth: 200, id: "comment", sortable: true },
];

export const MIN_COLUMN_WIDTH = 30;

export type ColumnState = { id: ColumnId; visible: boolean; width: number };

export type SortState = { column: ColumnId; desc: boolean } | undefined;

export type TableConfig = { columns: ColumnState[]; sort: SortState };

export const DEFAULT_CONFIG: TableConfig = {
  columns: COLUMNS.map((c) => ({ id: c.id, visible: c.id !== "album", width: c.defaultWidth })),
  sort: undefined,
};

/** Restore a stored config: unknown columns dropped, new columns appended, widths clamped. */
export function parseConfig(raw: string | null): TableConfig {
  if (!raw) return DEFAULT_CONFIG;
  try {
    const v = JSON.parse(raw) as Partial<TableConfig>;
    const known = new Map(COLUMNS.map((c) => [c.id, c]));
    const columns: ColumnState[] = [];
    for (const c of Array.isArray(v.columns) ? v.columns : []) {
      const def = known.get(c?.id);
      if (!def || columns.some((x) => x.id === def.id)) continue;
      const width =
        typeof c.width === "number" && Number.isFinite(c.width) ? c.width : def.defaultWidth;
      columns.push({
        id: def.id,
        visible: c.visible !== false,
        width: Math.max(MIN_COLUMN_WIDTH, width),
      });
    }
    for (const c of DEFAULT_CONFIG.columns)
      if (!columns.some((x) => x.id === c.id)) columns.push(c);
    const sort =
      v.sort && known.get(v.sort.column)?.sortable
        ? { column: v.sort.column, desc: v.sort.desc === true }
        : undefined;
    return { columns, sort };
  } catch {
    return DEFAULT_CONFIG;
  }
}

/** Click on a header: ascending → descending → unsorted. */
export function nextSort(current: SortState, column: ColumnId): SortState {
  if (current?.column !== column) return { column, desc: false };
  return current.desc ? undefined : { column, desc: true };
}

/** Key shown in the table: Camelot first, musical second ("8A · Am"). */
export function keyLabel(rawKey: string): string {
  const k = parseKey(rawKey);
  return k ? `${camelot(k)} · ${musical(k)}` : rawKey;
}

/** BPM with at most one decimal, no trailing ".0"; empty when unknown. */
export function formatBpm(bpm: number): string {
  return bpm > 0 ? String(Number(bpm.toFixed(1))) : "";
}

export function formatLength(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

type SortValue = number | string;

/** Sort key per column; keys sort around the Camelot wheel (1A, 1B, 2A, …). */
function sortValue(t: Track, column: ColumnId, linkCount: (id: string) => number): SortValue {
  switch (column) {
    case "bpm":
      // Unknown BPM sorts last ascending, like empty text.
      return t.bpm > 0 ? t.bpm : Number.MAX_SAFE_INTEGER;
    case "key": {
      const k = parseKey(t.key);
      return k ? k.num * 2 + (k.minor ? 0 : 1) : Number.MAX_SAFE_INTEGER;
    }
    case "length":
      return t.length;
    case "links":
      return linkCount(t.id);
    case "rating":
      return t.rating;
    case "album":
    case "artist":
    case "comment":
    case "genre":
    case "title":
      return t[column].toLocaleLowerCase();
    default:
      return 0;
  }
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Stable sort; empty strings always last. */
export function sortTracks(
  tracks: Track[],
  sort: SortState,
  linkCount: (id: string) => number = () => 0,
): Track[] {
  if (!sort) return tracks;
  const dir = sort.desc ? -1 : 1;
  const keyed = tracks.map((t, i) => ({ i, t, v: sortValue(t, sort.column, linkCount) }));
  keyed.sort((a, b) => {
    if (typeof a.v === "string" && typeof b.v === "string") {
      if (!a.v !== !b.v) return a.v ? -1 : 1;
      return collator.compare(a.v, b.v) * dir || a.i - b.i;
    }
    return ((a.v as number) - (b.v as number)) * dir || a.i - b.i;
  });
  return keyed.map((k) => k.t);
}

/** Lower-cased searchable text per track, computed once per track object. */
const haystacks = new WeakMap<Track, string>();

function haystack(t: Track): string {
  let hay = haystacks.get(t);
  if (hay === undefined) {
    hay = [t.title, t.artist, t.album, t.genre, t.comment, keyLabel(t.key)]
      .join("\n")
      .toLocaleLowerCase();
    haystacks.set(t, hay);
  }
  return hay;
}

/** Every whitespace-separated term must appear in one of the searchable fields. */
export function searchTracks(tracks: Track[], query: string): Track[] {
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return tracks;
  return tracks.filter((t) => {
    const hay = haystack(t);
    return terms.every((term) => hay.includes(term));
  });
}

/** Stars for a 0-5 rating (clamped). */
export function stars(rating: number): string {
  return "★".repeat(Math.max(0, Math.min(5, Math.round(rating) || 0)));
}
