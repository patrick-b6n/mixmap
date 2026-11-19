// Where to put a track that is dropped onto a node: next to it, in the first free
// slot of the column to its right (outgoing link) or left (incoming, Alt).

export type Point = { x: number; y: number };

/** Approximate node card size in flow units, plus spacing. */
export const NODE_WIDTH = 208;
export const NODE_HEIGHT = 56;
const COLUMN_GAP = 90;
const ROW_STEP = NODE_HEIGHT + 24;

function overlaps(p: Point, q: Point): boolean {
  return Math.abs(p.x - q.x) < NODE_WIDTH + 16 && Math.abs(p.y - q.y) < NODE_HEIGHT + 12;
}

/**
 * Free position beside `anchor`: same row if free, else alternating below/above
 * (0, +1, −1, +2, −2, …) until nothing overlaps.
 */
export function placeNextTo(anchor: Point, taken: Point[], side: "left" | "right"): Point {
  const x = anchor.x + (side === "right" ? 1 : -1) * (NODE_WIDTH + COLUMN_GAP);
  for (let i = 0; i < 200; i++) {
    const k = i === 0 ? 0 : (i % 2 === 1 ? 1 : -1) * Math.ceil(i / 2);
    const p = { x, y: anchor.y + k * ROW_STEP };
    if (!taken.some((t) => overlaps(p, t))) return p;
  }
  return { x, y: anchor.y };
}

/** Top-left position for a card dropped with its center at `point`. */
export function centeredAt(point: Point): Point {
  return { x: point.x - NODE_WIDTH / 2, y: point.y - NODE_HEIGHT / 2 };
}
