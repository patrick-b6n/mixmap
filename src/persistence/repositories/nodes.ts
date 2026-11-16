import type { GraphNodeRow, Track } from "@/business/model";
import { type Db, now, type Statement } from "./db";
import { tombstoneId } from "@/business/tombstones";
import { ensureTrackStatement } from "./tracks";

export async function listNodes(db: Db): Promise<GraphNodeRow[]> {
  const rows = await db.query<{ track_key: string; x: number; y: number }>(
    "SELECT track_key, x, y FROM nodes ORDER BY created_at, track_key",
  );
  return rows.map((r) => ({ trackKey: r.track_key, x: r.x, y: r.y }));
}

/** Statements that place `track` on the graph (adding it to mixmap.db if needed). */
export function addNodeStatements(
  track: Track,
  x: number,
  y: number,
): { key: string; statements: Statement[] } {
  const t = ensureTrackStatement(track);
  const ts = now();
  return {
    key: t.key,
    statements: [
      t.statement,
      // A newly placed node is no longer deleted (an existing one keeps its state).
      {
        params: [tombstoneId(t.key), t.key],
        sql: `DELETE FROM tombstones WHERE kind = 'node' AND id = ?
              AND NOT EXISTS (SELECT 1 FROM nodes WHERE track_key = ?)`,
      },
      {
        params: [t.key, x, y, ts, ts],
        sql: `INSERT INTO nodes (track_key, x, y, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT (track_key) DO NOTHING`,
      },
    ],
  };
}

/** Put a track on the graph at (x, y). A track already on it stays where it is. */
export async function addNode(db: Db, track: Track, x: number, y: number): Promise<string> {
  const { key, statements } = addNodeStatements(track, x, y);
  await db.execute(statements);
  return key;
}

/**
 * Persist new positions (after a drag or an auto-layout), in one transaction.
 * Nodes removed in the meantime are ignored.
 */
export async function moveNodes(db: Db, positions: GraphNodeRow[]): Promise<void> {
  if (positions.length === 0) return;
  const ts = now();
  await db.execute(
    positions.map((p) => ({
      params: [p.x, p.y, ts, p.trackKey],
      sql: "UPDATE nodes SET x = ?, y = ?, updated_at = ? WHERE track_key = ?",
    })),
  );
}

/** Take a track off the graph. Its links stay. */
export async function removeNode(db: Db, trackKey: string): Promise<void> {
  await db.execute(removeNodeStatements(trackKey));
}

/** Statements of `removeNode`, to combine with others in one transaction. */
export function removeNodeStatements(trackKey: string): Statement[] {
  return [
    // Tombstone only for a node that exists (never let a no-op win a later sync).
    {
      params: [tombstoneId(trackKey), now(), trackKey],
      sql: `INSERT INTO tombstones (kind, id, deleted_at)
            SELECT 'node', ?, ? WHERE EXISTS (SELECT 1 FROM nodes WHERE track_key = ?)
            ON CONFLICT (kind, id) DO UPDATE SET deleted_at = excluded.deleted_at`,
    },
    { params: [trackKey], sql: "DELETE FROM nodes WHERE track_key = ?" },
  ];
}

/**
 * Put a removed node back (Undo): by key, so it also works for tracks missing from
 * rekordbox. Skipped if the track is gone meanwhile.
 */
export async function restoreNode(db: Db, node: GraphNodeRow): Promise<boolean> {
  const ts = now();
  const exists = "EXISTS (SELECT 1 FROM tracks WHERE key = ?)";
  const [, inserted] = await db.execute([
    {
      params: [tombstoneId(node.trackKey), node.trackKey],
      sql: `DELETE FROM tombstones WHERE kind = 'node' AND id = ? AND ${exists}`,
    },
    {
      params: [node.trackKey, node.x, node.y, ts, ts, node.trackKey],
      sql: `INSERT INTO nodes (track_key, x, y, created_at, updated_at)
            SELECT ?, ?, ?, ?, ? WHERE ${exists} ON CONFLICT (track_key) DO NOTHING`,
    },
  ]);
  return (inserted?.changes ?? 0) > 0;
}
