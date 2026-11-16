// The data model shared by all layers: what the Rust backend reports about the
// rekordbox library, network sync and calibration, and mixmap's own rows.

export type Track = {
  album: string;
  artist: string;
  artworkPath: string | null;
  bpm: number;
  comment: string;
  filePath: string;
  genre: string;
  id: string;
  /** rekordbox key as stored; parse with business/keys. */
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
export type LibrarySource =
  | { kind: "auto" }
  | { kind: "masterDb"; path: string }
  | { kind: "xml"; path: string };

export type LibraryStatus = {
  error: string | null;
  location: Location | null;
  playlistCount: number;
  source: LibrarySource;
  trackCount: number;
  version: number;
};

/** This mixmap instance on the network. */
export type Device = { id: string; name: string };

/** Another mixmap instance found on the LAN (mDNS). */
export type Peer = Device & { addresses: string[]; port: number; protocol: number };

/** A device this one is paired with (it may be offline). */
export type PairedPeer = Device & {
  lastAddress: string | null;
  lastSyncAt: number | null;
  pairedAt: number;
};

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

/** A mixmap track row (identity = portable key). */
export type TrackRow = {
  artist: string;
  duration: number;
  key: string;
  missing: boolean;
  rekordboxId: string | null;
  title: string;
};

/** A track placed on the graph (a card) and its position. */
export type GraphNodeRow = { trackKey: string; x: number; y: number };
