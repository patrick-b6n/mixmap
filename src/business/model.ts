// The data model shared by all layers: what the Rust backend reports about the
// rekordbox library, network sync and calibration, and mixmap's own rows.

export type Track = {
  album: string;
  /** rekordbox analysis file as stored (relative to the analysis root). */
  analysisPath: string | null;
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

/** A hot cue, memory cue or loop of a track (from master.db). */
export type Cue = {
  /** rekordbox cue colour 1–8 (pink … purple); null = default colour. */
  color: number | null;
  comment: string;
  /** Loop end; null for a point cue. */
  endMs: number | null;
  /** "A"–"H"; null for a memory cue. */
  hotCue: string | null;
  startMs: number;
};

export type Beat = {
  /** 1–4; 1 = downbeat. */
  barPosition: number;
  timeMs: number;
};

export type PhraseKind = "bridge" | "chorus" | "down" | "intro" | "outro" | "up" | "verse";

export type Phrase = {
  endMs: number;
  kind: PhraseKind;
  /** Verse number; null for other kinds. */
  number: number | null;
  startMs: number;
};

/** Whole-track overview: per column one height (0–31), or three (low, mid, high). */
export type Waveform = { kind: "mono"; values: number[] } | { kind: "threeBand"; values: number[] };

/** What rekordbox's analysis files say about a track. */
export type Analysis = {
  beats: Beat[];
  phrases: Phrase[];
  waveform: Waveform | null;
};

/** Cues and analysis of one track; `analysis` is null without analysis files. */
export type TrackAnalysis = {
  analysis: Analysis | null;
  cues: Cue[];
};

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
