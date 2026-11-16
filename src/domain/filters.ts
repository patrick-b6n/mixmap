// Graph filters: which nodes match. Never applied to the track table.
import type { Track } from "../api";
import type { Link } from "../db/links";
import { compatible, type CompatibilityRule } from "./compatibility";
import { camelot, parseKey } from "./keys";

/** Filter settings from the filter bar. Empty/undefined fields don't filter. */
export type GraphFilter = {
  artist?: string;
  bpmMax?: number;
  bpmMin?: number;
  /** Text in the track's rekordbox comment or in the comment of one of its links. */
  comment?: string;
  genre?: string;
  /** "Compatible with selected": key and BPM must fit the selected track. */
  compatible?: CompatibilityRule;
  /** Camelot key, e.g. "8A" (any notation that parseKey understands). */
  key?: string;
  /** Minimum rekordbox rating (stars). */
  minRating?: number;
  /** Title contains. */
  name?: string;
};

/** What a node offers to filter on. Missing tracks only have artist/title. */
export type FilterSubject = {
  artist: string;
  bpm?: number;
  comment?: string;
  genre?: string;
  key?: string;
  /** Comments of the track's links (in and out). */
  linkComments: string[];
  rating?: number;
  title: string;
};

const contains = (hay: string | undefined, needle: string) =>
  (hay ?? "").toLocaleLowerCase().includes(needle.trim().toLocaleLowerCase());

const blank = (s: string | undefined): s is undefined => s === undefined || s.trim() === "";

/** Whether any filter field is set. */
export function isActive(f: GraphFilter): boolean {
  return (
    !blank(f.artist) ||
    !blank(f.comment) ||
    !blank(f.genre) ||
    !blank(f.key) ||
    !blank(f.name) ||
    f.bpmMin !== undefined ||
    f.bpmMax !== undefined ||
    f.compatible !== undefined ||
    (f.minRating ?? 0) > 0
  );
}

/** All set fields must match (AND). Unknown values (missing tracks) don't match numeric/key filters. */
export function matches(f: GraphFilter, s: FilterSubject): boolean {
  if (!blank(f.name) && !contains(s.title, f.name)) return false;
  if (!blank(f.artist) && !contains(s.artist, f.artist)) return false;
  if (!blank(f.genre) && !contains(s.genre, f.genre)) return false;
  if (!blank(f.comment) && !contains(s.comment, f.comment) && !s.linkComments.some((c) => contains(c, f.comment!))) {
    return false;
  }
  if (f.bpmMin !== undefined && !(s.bpm !== undefined && s.bpm > 0 && s.bpm >= f.bpmMin)) return false;
  if (f.bpmMax !== undefined && !(s.bpm !== undefined && s.bpm > 0 && s.bpm <= f.bpmMax)) return false;
  if ((f.minRating ?? 0) > 0 && (s.rating ?? 0) < f.minRating!) return false;
  if (!blank(f.key)) {
    const want = parseKey(f.key);
    const have = s.key ? parseKey(s.key) : undefined;
    if (!want || !have || camelot(want) !== camelot(have)) return false;
  }
  if (f.compatible && !compatible(f.compatible, s)) return false;
  return true;
}

/** What a graph node offers to the filters: its rekordbox track, or what mixmap.db remembers. */
export function subjectOf(
  card: { artist: string; key: string; title: string; track?: Track },
  links: Pick<Link, "comment" | "from" | "to">[],
): FilterSubject {
  const t = card.track;
  return {
    artist: card.artist,
    bpm: t?.bpm,
    comment: t?.comment,
    genre: t?.genre,
    key: t?.key,
    linkComments: links.filter((l) => l.comment && (l.from === card.key || l.to === card.key)).map((l) => l.comment),
    rating: t?.rating,
    title: card.title,
  };
}

/** Ids of the nodes that match the filter (all of them when it is inactive). */
export function matchingNodes(
  f: GraphFilter,
  nodes: { card: Parameters<typeof subjectOf>[0]; id: string }[],
  links: Pick<Link, "comment" | "from" | "to">[],
): Set<string> {
  if (!isActive(f)) return new Set(nodes.map((n) => n.id));
  return new Set(nodes.filter((n) => matches(f, subjectOf(n.card, links))).map((n) => n.id));
}
