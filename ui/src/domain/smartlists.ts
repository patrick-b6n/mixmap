// rekordbox smart ("intelligent") playlists: parse the rule XML and evaluate it
// against the library. Only rules whose value format is known are evaluated; a list
// with any other rule stays empty and says why (better than wrong contents).
import type { Playlist, Track } from "../api";

export type Condition = { operator: number; property: string; valueLeft: string; valueRight: string; unit: string };
export type SmartRules = { all: boolean; conditions: Condition[] };

/** rekordbox operator codes (as stored in `SmartList`). */
const OP = {
  contains: 8,
  endsWith: 11,
  equal: 1,
  notContains: 9,
  notEqual: 2,
  startsWith: 10,
} as const;

/** Text properties MixMap can evaluate, by rekordbox `PropertyName`. */
const TEXT: Record<string, (t: Track) => string> = {
  album: (t) => t.album,
  artist: (t) => t.artist,
  comments: (t) => t.comment,
  fileName: (t) => t.filePath.split(/[\\/]/).pop() ?? "",
  genre: (t) => t.genre,
  name: (t) => t.title,
};

const TEXT_OPS = new Set<number>(Object.values(OP));

const unescape = (s: string) =>
  s
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([A-Za-z]+)="([^"]*)"/g)) out[m[1]] = unescape(m[2]);
  return out;
}

/** Parse rekordbox's `<NODE LogicalOperator=…><CONDITION …/>…</NODE>`; undefined if it isn't that. */
export function parseSmartList(xml: string): SmartRules | undefined {
  const node = /<NODE\b[^>]*>/.exec(xml);
  if (!node) return undefined;
  const conditions = [...xml.matchAll(/<CONDITION\b[^>]*\/?>/g)].map((m) => {
    const a = attrs(m[0]);
    return {
      operator: Number(a.Operator),
      property: a.PropertyName ?? "",
      unit: a.ValueUnit ?? "",
      valueLeft: a.ValueLeft ?? "",
      valueRight: a.ValueRight ?? "",
    };
  });
  // 1 = all conditions, 2 = any condition.
  return { all: attrs(node[0]).LogicalOperator !== "2", conditions };
}

/** Conditions MixMap can't evaluate yet (by property name), empty when all are fine. */
export function unsupported(rules: SmartRules): string[] {
  return [
    ...new Set(
      rules.conditions.filter((c) => !(c.property in TEXT && TEXT_OPS.has(c.operator))).map((c) => c.property),
    ),
  ];
}

function test(c: Condition, t: Track): boolean {
  const have = TEXT[c.property](t).toLocaleLowerCase();
  const want = c.valueLeft.toLocaleLowerCase();
  switch (c.operator) {
    case OP.equal:
      return have === want;
    case OP.notEqual:
      return have !== want;
    case OP.contains:
      return have.includes(want);
    case OP.notContains:
      return !have.includes(want);
    case OP.startsWith:
      return have.startsWith(want);
    case OP.endsWith:
      return have.endsWith(want);
    default:
      return false;
  }
}

/** Ids of the tracks matching the rules, in library order (all rules must be supported). */
export function evaluate(rules: SmartRules, tracks: Track[]): string[] {
  if (rules.conditions.length === 0) return [];
  const match = (t: Track) =>
    rules.all ? rules.conditions.every((c) => test(c, t)) : rules.conditions.some((c) => test(c, t));
  return tracks.filter(match).map((t) => t.id);
}

/**
 * Fill the contents of smart playlists. Lists with rules MixMap can't evaluate keep no
 * tracks and get `smartNote` explaining why.
 */
export function fillSmartPlaylists(playlists: Playlist[], tracks: Track[]): Playlist[] {
  return playlists.map((p) => {
    if (p.kind !== "smart" || !p.smartList) return p;
    const rules = parseSmartList(p.smartList);
    if (!rules) return { ...p, smartNote: "The rules of this smart playlist couldn't be read." };
    const missing = unsupported(rules);
    if (missing.length > 0) {
      return { ...p, smartNote: `Rules on ${missing.join(", ")} aren't supported yet, so this list is empty.` };
    }
    return { ...p, trackIds: evaluate(rules, tracks) };
  });
}
