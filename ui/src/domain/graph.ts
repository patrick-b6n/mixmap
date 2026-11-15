// Turning board data into what the graph canvas draws. Pure functions, no React.
import type { Track } from "../api";
import type { BoardNode } from "../db/boards";
import type { Link } from "../db/links";
import type { TrackRow } from "../db/tracks";

/** What a node card shows. `track` is the rekordbox track, absent when missing. */
export type NodeCard = {
  artist: string;
  key: string;
  linkCount: number;
  missing: boolean;
  title: string;
  track?: Track;
};

export type GraphNode = { card: NodeCard; id: string; x: number; y: number };

export type GraphEdge = {
  comment: string;
  from: string;
  id: string;
  rating: number | null;
  to: string;
  /** Stroke width in px, by rating. */
  width: number;
};

/** Edge id for a link (stable across reloads). */
export const edgeId = (from: string, to: string): string => `${from}\u0001${to}`;

/** Unrated 1.5 px; rating 1–5 → 1.5…5.5 px. */
export function edgeWidth(rating: number | null): number {
  return rating === null ? 1.5 : 0.5 + rating;
}

/** Number of links (incoming + outgoing) per track key, over all links. */
export function linkCounts(links: Pick<Link, "from" | "to">[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const l of links) {
    counts.set(l.from, (counts.get(l.from) ?? 0) + 1);
    counts.set(l.to, (counts.get(l.to) ?? 0) + 1);
  }
  return counts;
}

/**
 * Nodes and edges of a board. Each node shows the current rekordbox track (via the
 * cached rekordbox id) or, when it is missing, what mixmap.db remembers about it.
 * Edges are the links whose two endpoints are on the board.
 */
export function buildGraph(
  nodes: BoardNode[],
  links: Link[],
  tracks: Map<string, TrackRow>,
  library: Map<string, Track>,
): { edges: GraphEdge[]; nodes: GraphNode[] } {
  const counts = linkCounts(links);
  const onBoard = new Set(nodes.map((n) => n.trackKey));
  const graphNodes = nodes.map((n): GraphNode => {
    const row = tracks.get(n.trackKey);
    const track = row?.rekordboxId && !row.missing ? library.get(row.rekordboxId) : undefined;
    return {
      card: {
        artist: track?.artist ?? row?.artist ?? "",
        key: n.trackKey,
        linkCount: counts.get(n.trackKey) ?? 0,
        missing: !track,
        title: track?.title ?? row?.title ?? n.trackKey,
        track,
      },
      id: n.trackKey,
      x: n.x,
      y: n.y,
    };
  });
  const edges = links
    .filter((l) => onBoard.has(l.from) && onBoard.has(l.to))
    .map((l) => ({
      comment: l.comment,
      from: l.from,
      id: edgeId(l.from, l.to),
      rating: l.rating,
      to: l.to,
      width: edgeWidth(l.rating),
    }));
  return { edges, nodes: graphNodes };
}
