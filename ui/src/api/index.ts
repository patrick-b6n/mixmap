// Single API adapter: HTTP to the devserver in the browser, Tauri `invoke` later.
// Every backend call goes through `call(command, args)`; the command name maps to
// `POST /api/<command>` over HTTP and to the Tauri command of the same name.

export type Hello = { message: string; version: string };

export type Track = {
  album: string;
  artist: string;
  artworkPath: string | null;
  bpm: number;
  comment: string;
  filePath: string;
  genre: string;
  id: string;
  /** rekordbox key as stored; parse with domain/keys. */
  key: string;
  /** Seconds. */
  length: number;
  /** 0–5 stars. */
  rating: number;
  title: string;
};

export type PlaylistKind = "folder" | "history" | "playlist" | "smart";

export type Playlist = {
  id: string;
  kind: PlaylistKind;
  name: string;
  parentId: string | null;
  seq: number;
  /** Ordered contents; empty for folders and smart playlists. */
  trackIds: string[];
};

/** One consistent snapshot of the rekordbox library. */
export type Library = {
  histories: Playlist[];
  playlists: Playlist[];
  tracks: Track[];
  version: number;
};

export type ArtworkSize = "large" | "small";

export type Location = { analysisRoot: string | null; dbPath: string; overridden: boolean };

/** Where the library comes from. */
export type LibrarySource = { kind: "auto" } | { kind: "masterDb"; path: string } | { kind: "xml"; path: string };

export type LibraryStatus = {
  error: string | null;
  location: Location | null;
  playlistCount: number;
  source: LibrarySource;
  trackCount: number;
  version: number;
};

/** This MixMap instance on the network. */
export type Device = { id: string; name: string };

/** Another MixMap instance found on the LAN (mDNS). */
export type Peer = Device & { addresses: string[]; port: number; protocol: number };

/** A device this one is paired with (it may be offline). */
export type PairedPeer = Device & { lastAddress: string | null; lastSyncAt: number | null; pairedAt: number };

export type SyncStatus = {
  device: Device | null;
  error: string | null;
  paired: PairedPeer[];
  peers: Peer[];
  port: number;
};

/** Sync protocol version this app speaks. */
export const SYNC_PROTOCOL = 1;

/** One calibration round's result: candidate chains left per deck. */
export type CalibrationRound = {
  decks: { artist: number; deck: number; title: number }[];
  ready: boolean;
  rounds: number;
};

type Args = Record<string, unknown>;

declare global {
  interface Window {
    __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: Args) => Promise<unknown> };
  }
}

export async function call<T>(command: string, args: Args = {}): Promise<T> {
  const tauri = window.__TAURI_INTERNALS__;
  if (tauri) return (await tauri.invoke(command, args)) as T;
  const res = await fetch(`/api/${command}`, {
    body: JSON.stringify(args),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!res.ok) throw new Error(`${command}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/**
 * Image URL for a track's artwork (204 = no artwork → show a placeholder). `version` is the
 * library version, so a reload busts the browser cache.
 * TODO(#42): Tauri needs a custom protocol for this.
 */
export function artworkUrl(trackId: string, size: ArtworkSize, version: number): string {
  return `/api/artwork/${encodeURIComponent(trackId)}?size=${size}&v=${version}`;
}

export const api = {
  calibrationCancel: () => call<boolean>("calibration_cancel"),
  /** One round: what is loaded on each deck right now. */
  calibrationRound: (loaded: { artist: string; deck: number; title: string }[]) =>
    call<CalibrationRound>("calibration_round", { loaded }),
  calibrationSave: () => call<{ path: string }>("calibration_save"),
  /** Attach to the running rekordbox; fails when it isn't running. */
  calibrationStart: () => call<{ version: string }>("calibration_start"),
  hello: () => call<Hello>("hello"),
  library: () => call<Library>("library"),
  /** Last now-playing update from the automatic source (null before the first). */
  nowPlaying: () => call<unknown>("now_playing"),
  libraryStatus: () => call<LibraryStatus>("library_status"),
  refresh: () => call<LibraryStatus>("refresh"),
  setLibrarySource: (source: LibrarySource) => call<LibraryStatus>("set_library_source", { source }),
  pairConfirm: (peerId: string, code: string) => call<PairedPeer>("pair_confirm", { code, peerId }),
  pairStart: (peerId: string) => call<{ name: string }>("pair_start", { peerId }),
  /** "Sync now": send our export to a paired device; returns its export and what changed there. */
  syncExchange: (peerId: string, data: unknown) =>
    call<{ data: unknown; summary: unknown }>("sync_exchange", { data, peerId }),
  /** Answer a `sync-request` event (our export before merging, or an error). */
  syncReply: (requestId: string, reply: { data?: unknown; error?: string; summary?: unknown }) =>
    call<boolean>("sync_reply", { reply, requestId }),
  syncStatus: () => call<SyncStatus>("sync_status"),
  unpair: (peerId: string) => call<boolean>("unpair", { peerId }),
};

export { subscribe } from "./events";
