// "Sync now" between two paired mixmap instances. Both sides merge the other's data
// with the same rules (business/merge.ts), so afterwards they hold the same data:
//   initiator: export → (network) → peer: export its own, merge ours, answer with its own
//   initiator: merge the peer's answer.
import { checkExport, type MixmapExport } from "./exchange";
import type { MergeSummary } from "./merge";
import type { ExchangeRepository, LibraryById } from "./ports";

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
  data: ExchangeRepository,
  library: LibraryById,
  exchange: Exchange,
): Promise<SyncResult> {
  const local = await data.export(library);
  const answer = await exchange(local);
  const theirs = checkExport(answer.data);
  const received = await data.import(theirs, "merge", library);
  return { received, sent: isSummary(answer.summary) ? answer.summary : undefined };
}

/**
 * Peer side, for a `sync-request`: export what we have (before merging), then merge
 * the initiator's data. The export goes back as the answer.
 */
export async function answerSync(
  repository: ExchangeRepository,
  library: LibraryById,
  incoming: unknown,
): Promise<{ data: MixmapExport; summary: MergeSummary }> {
  const theirs = checkExport(incoming);
  const data = await repository.export(library);
  const summary = await repository.import(theirs, "merge", library);
  return { data, summary };
}

function isSummary(v: unknown): v is MergeSummary {
  return typeof v === "object" && v !== null && "links" in v && "nodes" in v;
}

/** Total of added + updated + deleted across a summary. */
export function changeCount(s: MergeSummary | undefined): number {
  if (!s) return 0;
  return Object.values(s).reduce((n, c) => n + c.added + c.updated + c.deleted, 0);
}
