/** Drag payload type for a rekordbox track id (table → graph). */
export const TRACK_MIME = "application/x-mixmap-track";

/** A track dropped on the canvas: onto a node (link) or empty space (just add). */
export type TrackDrop = {
  /** Key of the node it was dropped onto, if any. */
  onto?: string;
  /** Drop point in flow coordinates. */
  position: { x: number; y: number };
  /** Current canvas positions of all nodes (may be newer than the database). */
  positions: { key: string; x: number; y: number }[];
  /** Alt held: link dropped track → node instead of node → dropped track. */
  reverse: boolean;
  trackId: string;
};
