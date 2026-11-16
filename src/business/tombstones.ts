/** Horizontal space between former boards when they are merged into one graph. */
export const BOARD_GAP = 400;

export type TombstoneKind = "link" | "manual_match" | "node" | "track";

/** Tombstone id of a row: its natural key, parts joined with U+0001. */
export function tombstoneId(...keyParts: string[]): string {
  return keyParts.join("\u0001");
}
