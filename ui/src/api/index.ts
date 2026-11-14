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

export type LibraryStatus = {
  error: string | null;
  location: Location | null;
  playlistCount: number;
  trackCount: number;
  version: number;
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
 * Image URL for a track's artwork (404 → show a placeholder). `version` is the
 * library version, so a reload busts the browser cache.
 * TODO(#42): Tauri needs a custom protocol for this.
 */
export function artworkUrl(trackId: string, size: ArtworkSize, version: number): string {
  return `/api/artwork/${encodeURIComponent(trackId)}?size=${size}&v=${version}`;
}

export const api = {
  hello: () => call<Hello>("hello"),
  library: () => call<Library>("library"),
  libraryStatus: () => call<LibraryStatus>("library_status"),
  refresh: () => call<LibraryStatus>("refresh"),
};

export { subscribe } from "./events";
