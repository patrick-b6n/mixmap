// Interfaces (ports) the business logic and the UI depend on. src/persistence
// implements the repositories on mixmap.db, src/app the backend on the Tauri host;
// src/app/services.ts wires them together.
import type { ImportMode, MixmapExport } from "./exchange";
import type { Endpoint, Link, LinkPatch } from "./links";
import type { LibraryTrack, MatchResult, TrackIdentity } from "./matching";
import type { MergeSummary } from "./merge";
import type {
  CalibrationRound,
  GraphNodeRow,
  Library,
  LibrarySource,
  LibraryStatus,
  PairedPeer,
  SyncStatus,
  Track,
  TrackAnalysis,
  TrackRow,
} from "./model";

/** rekordbox tracks by id (to describe manual matches portably). */
export type LibraryById = ReadonlyMap<string, TrackIdentity>;

export interface LinksRepository {
  list(): Promise<Link[]>;
  get(from: string, to: string): Promise<Link | undefined>;
  /** At most one link per direction: an existing link is returned unchanged. */
  create(from: Endpoint, to: Endpoint, init?: LinkPatch): Promise<Link>;
  /** Many links in one transaction (pair import). Existing ones are left alone. */
  createMany(pairs: { from: Endpoint; to: Endpoint }[]): Promise<void>;
  update(from: string, to: string, patch: LinkPatch): Promise<Link>;
  /** Delete links, leaving tombstones (so deletions sync). */
  deleteMany(links: Pick<Link, "from" | "to">[]): Promise<void>;
  /** Undo deletions; returns how many came back (not those whose tracks are gone). */
  restore(links: Link[]): Promise<number>;
}

export interface NodesRepository {
  list(): Promise<GraphNodeRow[]>;
  /**
   * Put a track on the graph at (x, y) – unless it is there already – and create
   * `link` with it, in one transaction: never a node without its link.
   */
  place(
    placement: { track: Track; x: number; y: number } | undefined,
    link?: { from: Endpoint; to: Endpoint },
  ): Promise<void>;
  /** Persist new positions; nodes removed in the meantime are ignored. */
  move(positions: GraphNodeRow[]): Promise<void>;
  /** Take a track off the graph and delete `links` with it, in one transaction. */
  remove(trackKey: string, links?: Pick<Link, "from" | "to">[]): Promise<void>;
  /** Undo a removal; false if the track is gone meanwhile. */
  restore(node: GraphNodeRow): Promise<boolean>;
}

export interface TracksRepository {
  list(): Promise<TrackRow[]>;
  /** Match against the library; flag missing tracks; list unmatched ones. */
  reconcile(library: LibraryTrack[]): Promise<MatchResult[]>;
  setManualMatch(trackKey: string, rekordboxId: string): Promise<void>;
}

export interface SettingsRepository {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

export interface ExchangeRepository {
  /** All syncable data. */
  export(library?: LibraryById): Promise<MixmapExport>;
  /** Import in one transaction ("merge": newer wins; "replace": file replaces all). */
  import(data: MixmapExport, mode: ImportMode, library?: LibraryById): Promise<MergeSummary>;
  /** Delete all synced data; machine-local settings stay. */
  reset(): Promise<void>;
}

/** The Rust backend: rekordbox library, files, network sync, now playing. */
export interface Backend {
  version(): Promise<string>;
  library(): Promise<Library>;
  libraryStatus(): Promise<LibraryStatus>;
  refresh(): Promise<LibraryStatus>;
  setLibrarySource(source: LibrarySource): Promise<LibraryStatus>;
  /** Cues and analysis (waveform, beat grid, phrases) of a library track. */
  trackAnalysis(trackId: string): Promise<TrackAnalysis>;
  /** Saves a backup file into the backups folder; returns its full path. */
  writeBackup(content: string, name: string): Promise<string>;
  syncStatus(): Promise<SyncStatus>;
  pairStart(peerId: string): Promise<{ name: string }>;
  pairConfirm(peerId: string, code: string): Promise<PairedPeer>;
  unpair(peerId: string): Promise<boolean>;
  /** "Sync now": our export to a paired device; its export and what changed there. */
  syncExchange(peerId: string, data: unknown): Promise<{ data: unknown; summary: unknown }>;
  /** Answer a `sync-request` event (our export before merging, or an error). */
  syncReply(
    requestId: string,
    reply: { data?: unknown; error?: string; summary?: unknown },
  ): Promise<boolean>;
  /** Last now-playing update from the automatic source (null before the first). */
  nowPlaying(): Promise<unknown>;
  calibrationStart(): Promise<{ version: string }>;
  calibrationRound(
    loaded: { artist: string; deck: number; title: string }[],
  ): Promise<CalibrationRound>;
  calibrationSave(): Promise<{ path: string }>;
  calibrationCancel(): Promise<boolean>;
}
