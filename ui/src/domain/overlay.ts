// What the live overlay shows for a deck: its track's outgoing links ("I can mix this
// into…"), best rated first, with the target's BPM/key and whether it's already loaded.
import type { Track } from "../api";
import type { Link } from "../db/links";
import type { TrackRow } from "../db/tracks";
import { portableKey } from "./matching";
import { decksWith, type NowPlayingState } from "./nowPlaying";

export type OverlayLink = {
  comment: string;
  /** Other decks this target is loaded on right now. */
  loadedOn: number[];
  rating: number | null;
  tags: string[];
  /** The target as rekordbox has it; absent when it's missing from the library. */
  target?: Track;
  /** Shown name (from the library, or what mixmap.db remembers). */
  targetArtist: string;
  targetKey: string;
  targetTitle: string;
};

/** Outgoing links of `track`, best rated first (unrated last), then by title. */
export function outgoingLinks(
  track: Track,
  deck: number,
  links: Link[],
  tracks: ReadonlyMap<string, TrackRow>,
  library: ReadonlyMap<string, Track>,
  state: NowPlayingState,
): OverlayLink[] {
  const key = portableKey(track);
  return links
    .filter((l) => l.from === key)
    .map((l): OverlayLink => {
      const row = tracks.get(l.to);
      const target = row?.rekordboxId && !row.missing ? library.get(row.rekordboxId) : undefined;
      return {
        comment: l.comment,
        loadedOn: target ? decksWith(state, target.id).filter((d) => d !== deck) : [],
        rating: l.rating,
        tags: l.tags,
        target,
        targetArtist: target?.artist ?? row?.artist ?? "",
        targetKey: l.to,
        targetTitle: target?.title ?? row?.title ?? l.to,
      };
    })
    .toSorted((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || a.targetTitle.localeCompare(b.targetTitle));
}
