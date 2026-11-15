// "Sync now" between two paired mixmap instances. Both sides merge the other's data
// with the same rules (domain/merge), so afterwards they hold the same data:
//   initiator: export → (network) → peer: export its own, merge ours, answer with its own
//   initiator: merge the peer's answer.
import type { Db } from "../db/db";
import { checkExport, exportData, importData, type MixmapExport } from "../db/exchange";
import type { TrackIdentity } from "../domain/matching";
import type { MergeSummary } from "../domain/merge";

/** Sends our export to the peer; resolves with its export and what changed there. */
export type Exchange = (data: MixmapExport) => Promise<{ data: unknown; summary: unknown }>;

export type SyncResult = {
  /** What the peer's data changed here. */
  received: MergeSummary;
  /** What our data changed on the peer (as it reported). */
  sent: MergeSummary | undefined;
};

/** Initiator side. Nothing changes here if the exchange or the peer's merge fails. */
export async function syncNow(
  db: Db,
  library: ReadonlyMap<string, TrackIdentity>,
  exchange: Exchange,
): Promise<SyncResult> {
  const local = await exportData(db, library);
  const answer = await exchange(local);
  const theirs = checkExport(answer.data);
  const received = await importData(db, theirs, "merge", library);
  return { received, sent: isSummary(answer.summary) ? answer.summary : undefined };
}

/**
 * Peer side, for a `sync-request`: export what we have (before merging), then merge
 * the initiator's data. The export goes back as the answer.
 */
export async function answerSync(
  db: Db,
  library: ReadonlyMap<string, TrackIdentity>,
  incoming: unknown,
): Promise<{ data: MixmapExport; summary: MergeSummary }> {
  const theirs = checkExport(incoming);
  const data = await exportData(db, library);
  const summary = await importData(db, theirs, "merge", library);
  return { data, summary };
}

function isSummary(v: unknown): v is MergeSummary {
  return typeof v === "object" && v !== null && "links" in v && "boards" in v;
}

/** Total of added + updated + deleted across a summary. */
export function changeCount(s: MergeSummary | undefined): number {
  if (!s) return 0;
  return Object.values(s).reduce((n, c) => n + c.added + c.updated + c.deleted, 0);
}
