// Merging mixmap data (import "merge" and network sync): last-write-wins per item,
// with tombstones so deletions propagate. Pure: works on two exports and returns
// what to change locally.
import type {
  ExportLink,
  ExportManualMatch,
  ExportNode,
  ExportSetting,
  ExportTombstone,
  ExportTrack,
  MixmapExport,
} from "./exchange";
import type { TombstoneKind } from "./tombstones";
import { portableKey, type TrackIdentity } from "./matching";

const SEP = "\u0001";

/** Changes to apply locally. Deletions also record their tombstone. */
export type MergePlan = {
  /** Rows to delete (and tombstone), children before parents. */
  deletes: ExportTombstone[];
  links: ExportLink[];
  manualMatches: ExportManualMatch[];
  nodes: ExportNode[];
  settings: ExportSetting[];
  summary: MergeSummary;
  /** Tombstones to record or raise without deleting anything (nothing to delete here). */
  tombstones: ExportTombstone[];
  tracks: ExportTrack[];
};

export type Counts = { added: number; deleted: number; updated: number };
export type MergeSummary = Record<"links" | "manualMatches" | "nodes" | "tracks", Counts>;

type Kind = "link" | "manual_match" | "node" | "setting" | "track";

/** One side's state of an item: a row (with its updatedAt) or a deletion. */
type State<R> = { row: R; ts: number } | { deletedAt: number; ts: number };

const isRow = <R>(s: State<R>): s is { row: R; ts: number } => "row" in s;

/**
 * Which state wins: the later one; on a tie a deletion wins, then the larger row (by
 * JSON), so both sides of a sync pick the same winner.
 */
function incomingWins<R>(local: State<R> | undefined, incoming: State<R>): boolean {
  if (!local) return true;
  if (incoming.ts !== local.ts) return incoming.ts > local.ts;
  if (isRow(incoming) !== isRow(local)) return !isRow(incoming);
  if (!isRow(incoming) || !isRow(local)) return false;
  // Same content (in any key order) is no change.
  return canonical(incoming.row) > canonical(local.row);
}

/** JSON with object keys sorted, so equal rows compare equal however they were built. */
function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : x,
  );
}

/** Item ids per kind (tombstone ids, see db/schema `tombstoneId`). */
const ids = {
  link: (l: ExportLink) => `${l.from}${SEP}${l.to}`,
  manual_match: (m: ExportManualMatch) => m.trackKey,
  node: (n: ExportNode) => n.trackKey,
  setting: (s: ExportSetting) => s.key,
  track: (t: ExportTrack) => t.key,
};

function states<R>(
  rows: R[],
  id: (r: R) => string,
  ts: (r: R) => number,
  tombs: Map<string, number>,
) {
  const m = new Map<string, State<R>>();
  for (const [i, deletedAt] of tombs) m.set(i, { deletedAt, ts: deletedAt });
  for (const r of rows) {
    const cur = m.get(id(r));
    // A row newer than (or as new as) its own tombstone is alive.
    if (!cur || ts(r) >= cur.ts) m.set(id(r), { row: r, ts: ts(r) });
  }
  return m;
}

function tombstonesByKind(t: ExportTombstone[], kind: TombstoneKind): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of t) if (x.kind === kind) m.set(x.id, Math.max(m.get(x.id) ?? 0, x.deletedAt));
  return m;
}

const zero = (): Counts => ({ added: 0, deleted: 0, updated: 0 });

/**
 * Where a manual match points on this machine: its rekordbox id if that track is
 * still the one it was (same portable key), else the unique library track with the
 * exported `targetKey`; null when it can't be resolved (the track lands in Unmatched).
 */
export function resolveManualMatch(
  m: Pick<ExportManualMatch, "rekordboxId" | "targetKey">,
  library: ReadonlyMap<string, TrackIdentity>,
): string | null {
  const byId = library.get(m.rekordboxId);
  if (m.targetKey === null) return m.rekordboxId;
  if (byId && portableKey(byId) === m.targetKey) return m.rekordboxId;
  const hits = [...library].filter(([, t]) => portableKey(t) === m.targetKey);
  return hits.length === 1 ? hits[0][0] : null;
}

/** Keep the upserts that pass `keep` (dropping the rest from `live`) and count them. */
function finish<R>(
  merged: { live: Set<string>; upserts: { existed: boolean; row: R }[] },
  id: (r: R) => string,
  counts: Counts | undefined,
  keep: (r: R) => boolean = () => true,
): R[] {
  const out: R[] = [];
  for (const u of merged.upserts) {
    if (!keep(u.row)) {
      if (!u.existed) merged.live.delete(id(u.row));
      continue;
    }
    out.push(u.row);
    if (counts) counts[u.existed ? "updated" : "added"]++;
  }
  return out;
}

const updated = <R extends { updatedAt: number }>(r: R) => r.updatedAt;

/**
 * Merge `incoming` into `local`. For every item the later of row/deletion wins; links
 * and nodes whose track doesn't survive are dropped, and tracks still referenced are
 * never deleted.
 */
export function mergeData(
  local: MixmapExport,
  incoming: MixmapExport,
  library: ReadonlyMap<string, TrackIdentity> = new Map(),
): MergePlan {
  const summary: MergeSummary = {
    links: zero(),
    manualMatches: zero(),
    nodes: zero(),
    tracks: zero(),
  };
  const deletes: ExportTombstone[] = [];
  const tombstones: ExportTombstone[] = [];

  /**
   * Merge one kind: the winning incoming rows (and whether they existed locally) and
   * the ids alive afterwards. Deletions go to `deletes` / `tombstones`.
   */
  function mergeKind<R>(
    kind: Kind,
    localRows: R[],
    incomingRows: R[],
    ts: (r: R) => number,
    counts?: Counts,
  ): { live: Set<string>; upserts: { existed: boolean; row: R }[] } {
    const id = ids[kind] as (r: R) => string;
    const tk = kind as TombstoneKind;
    const noTombs = new Map<string, number>();
    const mine = states(
      localRows,
      id,
      ts,
      kind === "setting" ? noTombs : tombstonesByKind(local.tombstones, tk),
    );
    const theirs = states(
      incomingRows,
      id,
      ts,
      kind === "setting" ? noTombs : tombstonesByKind(incoming.tombstones, tk),
    );
    const upserts: { existed: boolean; row: R }[] = [];
    const live = new Set([...mine].filter(([, s]) => isRow(s)).map(([i]) => i));
    for (const [i, s] of theirs) {
      const cur = mine.get(i);
      if (!incomingWins(cur, s)) continue;
      if (isRow(s)) {
        upserts.push({ existed: cur !== undefined && isRow(cur), row: s.row });
        live.add(i);
      } else if (cur && isRow(cur)) {
        deletes.push({ deletedAt: s.deletedAt, id: i, kind: tk });
        live.delete(i);
        if (counts) counts.deleted++;
      } else {
        tombstones.push({ deletedAt: s.deletedAt, id: i, kind: tk });
      }
    }
    return { live, upserts };
  }

  const tracks = mergeKind("track", local.tracks, incoming.tracks, updated, summary.tracks);
  const links = mergeKind("link", local.links, incoming.links, updated, summary.links);
  const nodes = mergeKind("node", local.nodes, incoming.nodes, updated, summary.nodes);
  const manual = mergeKind(
    "manual_match",
    local.manualMatches,
    incoming.manualMatches,
    updated,
    summary.manualMatches,
  );
  const settings = mergeKind("setting", local.settings, incoming.settings, updated);

  // Rows whose track doesn't survive the merge are dropped.
  const trackRows = finish(tracks, ids.track, summary.tracks);
  const linkRows = finish(
    links,
    ids.link,
    summary.links,
    (l) => tracks.live.has(l.from) && tracks.live.has(l.to),
  );
  const nodeRows = finish(nodes, ids.node, summary.nodes, (n) => tracks.live.has(n.trackKey));
  const manualRows = finish(
    {
      live: manual.live,
      upserts: manual.upserts.flatMap((u) => {
        const rekordboxId = resolveManualMatch(u.row, library);
        return rekordboxId === null ? [] : [{ ...u, row: { ...u.row, rekordboxId } }];
      }),
    },
    ids.manual_match,
    summary.manualMatches,
  );
  const settingRows = finish(settings, ids.setting, undefined);

  // Tracks still referenced by a surviving link or node are never deleted.
  const referenced = new Set<string>(nodes.live);
  for (const i of links.live) for (const k of i.split(SEP)) referenced.add(k);
  const keptDeletes = deletes.filter((d) => {
    if (d.kind !== "track" || !referenced.has(d.id)) return true;
    summary.tracks.deleted--;
    return false;
  });

  // Children before parents.
  const order: TombstoneKind[] = ["node", "link", "manual_match", "track"];
  keptDeletes.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));

  return {
    deletes: keptDeletes,
    links: linkRows,
    manualMatches: manualRows,
    nodes: nodeRows,
    settings: settingRows,
    summary,
    tombstones,
    tracks: trackRows,
  };
}

/** Nothing (for "replace": merging into an empty database). */
export function emptyExport(exportedAt = 0): MixmapExport {
  return {
    exportedAt,
    format: "mixmap",
    links: [],
    manualMatches: [],
    nodes: [],
    settings: [],
    tombstones: [],
    tracks: [],
    version: 2,
  };
}
