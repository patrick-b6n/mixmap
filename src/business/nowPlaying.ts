// Now playing: what each rekordbox deck has loaded. Automatic sources (the memory
// reader, Rust) report raw title/artist per deck; manual mode sets tracks directly.
// Here both are resolved to library tracks and combined (manual wins per deck).
import type { Track } from "./model";
import { normalize } from "./matching";
import { searchTracks } from "./trackTable";

/** A deck as an automatic source reports it (empty title = nothing loaded). */
export type RawDeck = { artist: string; deck: number; title: string };

/** Backend event `now-playing`. */
export type NowPlayingUpdate =
  | { decks: RawDeck[]; master: number | null; source: string; status: "ok" }
  | { reason: string; source: string; status: "unavailable" };

export type Resolution =
  | { kind: "empty" }
  | { kind: "matched"; track: Track }
  /** Several library tracks have that title/artist. */
  | { candidates: Track[]; kind: "ambiguous" }
  /** Not in the library (or the source read garbage). */
  | { artist: string; kind: "unknown"; title: string };

export type DeckState = {
  deck: number;
  /** Set by manual mode (overrides the automatic source for this deck). */
  manual: boolean;
  resolution: Resolution;
};

export type NowPlayingState = { decks: DeckState[]; master: number | undefined };

/** Library lookup by normalized title, built once per library version. */
export type TrackIndex = Map<string, Track[]>;

export function buildIndex(tracks: Track[]): TrackIndex {
  const idx: TrackIndex = new Map();
  for (const t of tracks) {
    const k = normalize(t.title);
    const list = idx.get(k);
    if (list) list.push(t);
    else idx.set(k, [t]);
  }
  return idx;
}

/**
 * Find the library track for a title/artist. Same title and artist (normalized) wins;
 * else same title and one artist containing the other (sources may shorten "A, B").
 * Several hits: the single one that `preferred` accepts (e.g. it has links), else
 * ambiguous.
 */
export function resolveTrack(
  title: string,
  artist: string,
  index: TrackIndex,
  preferred: (t: Track) => boolean = () => false,
): Resolution {
  if (!title.trim()) return { kind: "empty" };
  const sameTitle = index.get(normalize(title)) ?? [];
  const a = normalize(artist);
  let hits = sameTitle.filter((t) => normalize(t.artist) === a);
  if (hits.length === 0 && a) {
    hits = sameTitle.filter((t) => {
      const b = normalize(t.artist);
      return b !== "" && (b.includes(a) || a.includes(b));
    });
  }
  if (hits.length === 0 && !a) hits = sameTitle;
  if (hits.length === 1) return { kind: "matched", track: hits[0] };
  if (hits.length > 1) {
    const pref = hits.filter(preferred);
    if (pref.length === 1) return { kind: "matched", track: pref[0] };
    return { candidates: hits, kind: "ambiguous" };
  }
  return { artist, kind: "unknown", title };
}

/** Manual mode: deck → library track id (undefined = cleared) and an optional master. */
export type ManualState = { decks: Record<number, string | undefined>; master?: number };

/**
 * Combine the automatic source's last update with manual settings. Decks from both are
 * listed (sorted); a manual deck overrides the automatic one. Master: manual, else the
 * source's.
 */
export function combine(
  auto: NowPlayingUpdate | undefined,
  manual: ManualState,
  index: TrackIndex,
  byId: ReadonlyMap<string, Track>,
  preferred?: (t: Track) => boolean,
): NowPlayingState {
  const decks = new Map<number, DeckState>();
  if (auto?.status === "ok") {
    for (const d of auto.decks) {
      decks.set(d.deck, {
        deck: d.deck,
        manual: false,
        resolution: resolveTrack(d.title, d.artist, index, preferred),
      });
    }
  }
  for (const [k, id] of Object.entries(manual.decks)) {
    const deck = Number(k);
    if (id === undefined) continue;
    const track = byId.get(id);
    decks.set(deck, {
      deck,
      manual: true,
      resolution: track ? { kind: "matched", track } : { kind: "empty" },
    });
  }
  const master = manual.master ?? (auto?.status === "ok" ? (auto.master ?? undefined) : undefined);
  return { decks: [...decks.values()].toSorted((x, y) => x.deck - y.deck), master };
}

/** Deck numbers whose track is `id` (to mark "already loaded on another deck"). */
export function decksWith(state: NowPlayingState, id: string): number[] {
  return state.decks
    .filter((d) => d.resolution.kind === "matched" && d.resolution.track.id === id)
    .map((d) => d.deck);
}

/**
 * Type-ahead for manual mode. With a query: matching tracks (same search as the track
 * table), title matches first. Without one: `suggestions` (e.g. link targets of the
 * other decks), as the likely next tracks.
 */
export function typeahead(
  tracks: Track[],
  query: string,
  suggestions: Track[],
  limit = 8,
): Track[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return suggestions.slice(0, limit);
  const hits = searchTracks(tracks, q);
  const inTitle = (t: Track) => (t.title.toLocaleLowerCase().includes(q) ? 0 : 1);
  return hits
    .toSorted((a, b) => inTitle(a) - inTitle(b) || a.title.localeCompare(b.title))
    .slice(0, limit);
}

/** Deck numbers to show: decks 1 and 2 always (so manual mode can start), plus any in use. */
export function shownDecks(state: NowPlayingState): number[] {
  return [...new Set([1, 2, ...state.decks.map((d) => d.deck)])].toSorted((a, b) => a - b);
}
