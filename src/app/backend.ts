// The Rust backend: every backend call goes through `call(command, args)`, which
// invokes the Tauri command `call`.

export type Hello = { message: string; version: string };

import type {
  ArtworkSize,
  CalibrationRound,
  Library,
  LibraryStatus,
  PairedPeer,
  SyncStatus,
} from "@/business/model";
import type { Backend } from "@/business/ports";

type Args = Record<string, unknown>;

declare global {
  interface Window {
    __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: Args) => Promise<unknown> };
  }
}

/** Running inside the desktop app (Tauri) rather than a browser tab? */
export const inTauri = (): boolean =>
  typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;

export async function call<T>(command: string, args: Args = {}): Promise<T> {
  const tauri = window.__TAURI_INTERNALS__;
  if (!tauri) throw new Error(`${command}: mixmap only runs as a desktop app`);
  try {
    return (await tauri.invoke("call", { args, command })) as T;
  } catch (e) {
    throw new Error(`${command}: ${typeof e === "string" ? e : String(e)}`, { cause: e });
  }
}

/**
 * Image URL for a track's artwork (204 = no artwork → show a placeholder). `version` is the
 * library version, so a reload busts the browser cache. The desktop app serves it through
 * its `artwork` URI scheme.
 */
export function artworkUrl(trackId: string, size: ArtworkSize, version: number): string {
  return `http://artwork.localhost/${encodeURIComponent(trackId)}?size=${size}&v=${version}`;
}

/** The {@link Backend} port on the Tauri host's `call` command (src-tauri/src/app.rs). */
export const backend: Backend = {
  calibrationCancel: () => call<boolean>("calibration_cancel"),
  calibrationRound: (loaded) => call<CalibrationRound>("calibration_round", { loaded }),
  calibrationSave: () => call<{ path: string }>("calibration_save"),
  calibrationStart: () => call<{ version: string }>("calibration_start"),
  library: () => call<Library>("library"),
  libraryStatus: () => call<LibraryStatus>("library_status"),
  nowPlaying: () => call<unknown>("now_playing"),
  pairConfirm: (peerId, code) => call<PairedPeer>("pair_confirm", { code, peerId }),
  pairStart: (peerId) => call<{ name: string }>("pair_start", { peerId }),
  refresh: () => call<LibraryStatus>("refresh"),
  setLibrarySource: (source) => call<LibraryStatus>("set_library_source", { source }),
  syncExchange: (peerId, data) =>
    call<{ data: unknown; summary: unknown }>("sync_exchange", { data, peerId }),
  syncReply: (requestId, reply) => call<boolean>("sync_reply", { reply, requestId }),
  syncStatus: () => call<SyncStatus>("sync_status"),
  unpair: (peerId) => call<boolean>("unpair", { peerId }),
  version: async () => (await call<Hello>("hello")).version,
  writeBackup: async (content, name) =>
    (await call<{ path: string }>("write_backup", { content, name })).path,
};
