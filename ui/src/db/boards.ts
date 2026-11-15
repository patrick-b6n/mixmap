import type { Track } from "../api";
import { type Db, newId, now, type Statement } from "./db";
import { type Link, listLinks } from "./links";
import { tombstoneId } from "./schema";
import { ensureTrackStatement } from "./tracks";

/** A named board ("Peak-time techno") with its own set of tracks and positions. */
export type Board = { createdAt: number; id: string; name: string; position: number; updatedAt: number };

/** A track placed on a board. */
export type BoardNode = { boardId: string; trackKey: string; x: number; y: number };

type RawBoard = { created_at: number; id: string; name: string; position: number; updated_at: number };

export async function listBoards(db: Db): Promise<Board[]> {
  const rows = await db.query<RawBoard>("SELECT * FROM boards ORDER BY position, created_at");
  return rows.map((r) => ({
    createdAt: r.created_at,
    id: r.id,
    name: r.name,
    position: r.position,
    updatedAt: r.updated_at,
  }));
}

function cleanName(name: string): string {
  const n = name.trim();
  if (!n) throw new Error("board name must not be empty");
  return n;
}

/** Create a board at the end of the tab list. */
export async function createBoard(db: Db, name: string): Promise<Board> {
  const id = newId();
  const ts = now();
  await db.execute([
    {
      params: [id, cleanName(name), ts, ts],
      sql: `INSERT INTO boards (id, name, position, created_at, updated_at)
            VALUES (?, ?, (SELECT IFNULL(MAX(position) + 1, 0) FROM boards), ?, ?)`,
    },
  ]);
  return (await listBoards(db)).find((b) => b.id === id)!;
}

export async function renameBoard(db: Db, id: string, name: string): Promise<void> {
  const [r] = await db.execute([
    { params: [cleanName(name), now(), id], sql: "UPDATE boards SET name = ?, updated_at = ? WHERE id = ?" },
  ]);
  if (r.changes === 0) throw new Error("board not found");
}

/** Delete a board and its node placements (tracks and links stay). */
export async function deleteBoard(db: Db, id: string): Promise<void> {
  const ts = now();
  await db.execute([
    // Tombstones for exactly the nodes being deleted, in the same transaction.
    {
      params: [ts, id],
      sql: `INSERT INTO tombstones (kind, id, deleted_at)
            SELECT 'board_node', board_id || char(1) || track_key, ? FROM board_nodes WHERE board_id = ?
            ON CONFLICT (kind, id) DO UPDATE SET deleted_at = excluded.deleted_at`,
    },
    {
      params: [ts, id],
      sql: `INSERT INTO tombstones (kind, id, deleted_at) SELECT 'board', id, ? FROM boards WHERE id = ?
            ON CONFLICT (kind, id) DO UPDATE SET deleted_at = excluded.deleted_at`,
    },
    { params: [id], sql: "DELETE FROM board_nodes WHERE board_id = ?" },
    { params: [id], sql: "DELETE FROM boards WHERE id = ?" },
  ]);
}

export async function listNodes(db: Db, boardId: string): Promise<BoardNode[]> {
  const rows = await db.query<{ track_key: string; x: number; y: number }>(
    "SELECT track_key, x, y FROM board_nodes WHERE board_id = ? ORDER BY created_at, track_key",
    [boardId],
  );
  return rows.map((r) => ({ boardId, trackKey: r.track_key, x: r.x, y: r.y }));
}

/** Statements that place `track` on a board (adding it to mixmap.db if needed). */
export function addNodeStatements(
  boardId: string,
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
        params: [tombstoneId(boardId, t.key), boardId, t.key],
        sql: `DELETE FROM tombstones WHERE kind = 'board_node' AND id = ?
              AND NOT EXISTS (SELECT 1 FROM board_nodes WHERE board_id = ? AND track_key = ?)`,
      },
      {
        params: [boardId, t.key, x, y, ts, ts],
        sql: `INSERT INTO board_nodes (board_id, track_key, x, y, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT (board_id, track_key) DO NOTHING`,
      },
    ],
  };
}

/** Put a track on a board at (x, y). A track already on the board stays where it is. */
export async function addNode(db: Db, boardId: string, track: Track, x: number, y: number): Promise<string> {
  const { key, statements } = addNodeStatements(boardId, track, x, y);
  await db.execute(statements);
  return key;
}

/**
 * Persist new positions (after a drag or an auto-layout), in one transaction.
 * Nodes removed in the meantime are ignored.
 */
export async function moveNodes(
  db: Db,
  boardId: string,
  positions: { trackKey: string; x: number; y: number }[],
): Promise<void> {
  if (positions.length === 0) return;
  const ts = now();
  await db.execute(
    positions.map((p) => ({
      params: [p.x, p.y, ts, boardId, p.trackKey],
      sql: "UPDATE board_nodes SET x = ?, y = ?, updated_at = ? WHERE board_id = ? AND track_key = ?",
    })),
  );
}

/** Remove a track from a board. Its links stay (they are global). */
export async function removeNode(db: Db, boardId: string, trackKey: string): Promise<void> {
  await db.execute([
    // Tombstone only for a node that exists (never let a no-op win a later sync).
    {
      params: [tombstoneId(boardId, trackKey), now(), boardId, trackKey],
      sql: `INSERT INTO tombstones (kind, id, deleted_at)
            SELECT 'board_node', ?, ? WHERE EXISTS (SELECT 1 FROM board_nodes WHERE board_id = ? AND track_key = ?)
            ON CONFLICT (kind, id) DO UPDATE SET deleted_at = excluded.deleted_at`,
    },
    { params: [boardId, trackKey], sql: "DELETE FROM board_nodes WHERE board_id = ? AND track_key = ?" },
  ]);
}

/**
 * Put a removed node back (Undo "Remove from board"): by key, so it also works for
 * tracks missing from rekordbox. Skipped if the track or board is gone meanwhile.
 */
export async function restoreNode(db: Db, node: BoardNode): Promise<boolean> {
  const ts = now();
  const exists = "EXISTS (SELECT 1 FROM tracks WHERE key = ?) AND EXISTS (SELECT 1 FROM boards WHERE id = ?)";
  const [, inserted] = await db.execute([
    {
      params: [tombstoneId(node.boardId, node.trackKey), node.trackKey, node.boardId],
      sql: `DELETE FROM tombstones WHERE kind = 'board_node' AND id = ? AND ${exists}`,
    },
    {
      params: [node.boardId, node.trackKey, node.x, node.y, ts, ts, node.trackKey, node.boardId],
      sql: `INSERT INTO board_nodes (board_id, track_key, x, y, created_at, updated_at)
            SELECT ?, ?, ?, ?, ?, ? WHERE ${exists} ON CONFLICT (board_id, track_key) DO NOTHING`,
    },
  ]);
  return inserted.changes > 0;
}

/** Links shown on a board: every link whose two endpoints are both on it. */
export function linksOnBoard(links: Link[], nodes: BoardNode[]): Link[] {
  const onBoard = new Set(nodes.map((n) => n.trackKey));
  return links.filter((l) => onBoard.has(l.from) && onBoard.has(l.to));
}

/** Nodes and visible links of a board. */
export async function loadBoard(db: Db, boardId: string): Promise<{ links: Link[]; nodes: BoardNode[] }> {
  const [nodes, links] = await Promise.all([listNodes(db, boardId), listLinks(db)]);
  return { links: linksOnBoard(links, nodes), nodes };
}
