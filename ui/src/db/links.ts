import type { Track } from "../api";
import { type Db, now, type Statement } from "./db";
import { tombstoneId } from "./schema";
import { ensureTrackStatement } from "./tracks";

/** A directed, global transition A → B ("I can mix `from` into `to`"). */
export type Link = {
  comment: string;
  createdAt: number;
  from: string;
  /** 1–5, or null when unrated. */
  rating: number | null;
  tags: string[];
  to: string;
  updatedAt: number;
};

export type LinkPatch = Partial<Pick<Link, "comment" | "rating" | "tags">>;

type RawLink = {
  comment: string;
  created_at: number;
  from_track: string;
  rating: number | null;
  tags: string;
  to_track: string;
  updated_at: number;
};

const COLUMNS = "from_track, to_track, comment, rating, tags, created_at, updated_at";

function fromRaw(r: RawLink): Link {
  let tags: string[] = [];
  try {
    const parsed: unknown = JSON.parse(r.tags);
    if (Array.isArray(parsed)) tags = parsed.filter((t): t is string => typeof t === "string");
  } catch {
    // keep []
  }
  return {
    comment: r.comment,
    createdAt: r.created_at,
    from: r.from_track,
    rating: r.rating,
    tags,
    to: r.to_track,
    updatedAt: r.updated_at,
  };
}

/** Tags are trimmed, de-duplicated (case-insensitive) and empty ones dropped. */
export function cleanTags(tags: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    if (typeof raw !== "string") continue;
    const t = raw.trim();
    if (t && !seen.has(t.toLocaleLowerCase())) {
      seen.add(t.toLocaleLowerCase());
      out.push(t);
    }
  }
  return out;
}

function checkRating(rating: number | null | undefined): void {
  if (rating !== null && rating !== undefined && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) {
    throw new Error(`rating must be 1–5, got ${rating}`);
  }
}

export async function listLinks(db: Db): Promise<Link[]> {
  return (await db.query<RawLink>(`SELECT ${COLUMNS} FROM links ORDER BY from_track, to_track`)).map(fromRaw);
}

export async function getLink(db: Db, from: string, to: string): Promise<Link | undefined> {
  const rows = await db.query<RawLink>(`SELECT ${COLUMNS} FROM links WHERE from_track = ? AND to_track = ?`, [
    from,
    to,
  ]);
  return rows[0] && fromRaw(rows[0]);
}

/** A rekordbox track (added to mixmap.db if needed) or the key of a stored track. */
export type Endpoint = Track | string;

function endpoint(e: Endpoint): { key: string; statements: Statement[] } {
  if (typeof e === "string") return { key: e, statements: [] };
  const t = ensureTrackStatement(e);
  return { key: t.key, statements: [t.statement] };
}

/**
 * Link `from` → `to`: rekordbox tracks (added to mixmap.db if needed) or keys of
 * stored tracks (e.g. a node whose rekordbox track is missing).
 * At most one link per direction: an existing link is returned unchanged.
 */
export async function createLink(db: Db, from: Endpoint, to: Endpoint, init: LinkPatch = {}): Promise<Link> {
  const { from: f, statements, to: t } = createLinkStatements(from, to, init);
  await db.execute(statements);
  return (await getLink(db, f, t))!;
}

/** Statements of `createLink`, to combine with other writes in one transaction. */
export function createLinkStatements(
  from: Endpoint,
  to: Endpoint,
  init: LinkPatch = {},
): { from: string; statements: Statement[]; to: string } {
  checkRating(init.rating);
  const a = endpoint(from);
  const b = endpoint(to);
  if (a.key === b.key) throw new Error("a track cannot link to itself");
  const ts = now();
  const statements: Statement[] = [
    ...a.statements,
    ...b.statements,
    // A newly created link is no longer deleted (only if it doesn't exist yet: an
    // existing link keeps whatever tombstone state sync gave it).
    {
      params: [tombstoneId(a.key, b.key), a.key, b.key],
      sql: `DELETE FROM tombstones WHERE kind = 'link' AND id = ?
            AND NOT EXISTS (SELECT 1 FROM links WHERE from_track = ? AND to_track = ?)`,
    },
    {
      params: [a.key, b.key, init.comment ?? "", init.rating ?? null, cleanTags(init.tags ?? []), ts, ts],
      sql: `INSERT INTO links (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    },
  ];
  return { from: a.key, statements, to: b.key };
}

/** Change comment, rating and/or tags. */
export async function updateLink(db: Db, from: string, to: string, patch: LinkPatch): Promise<Link> {
  checkRating(patch.rating);
  if (patch.comment === undefined && patch.rating === undefined && patch.tags === undefined) {
    const current = await getLink(db, from, to);
    if (!current) throw new Error("link not found");
    return current;
  }
  const sets: string[] = [];
  const params: (number | null | string | string[])[] = [];
  if (patch.comment !== undefined) {
    sets.push("comment = ?");
    params.push(patch.comment);
  }
  if (patch.rating !== undefined) {
    sets.push("rating = ?");
    params.push(patch.rating);
  }
  if (patch.tags !== undefined) {
    sets.push("tags = ?");
    params.push(cleanTags(patch.tags));
  }
  sets.push("updated_at = ?");
  params.push(now(), from, to);
  const [r] = await db.execute([
    { params, sql: `UPDATE links SET ${sets.join(", ")} WHERE from_track = ? AND to_track = ?` },
  ]);
  if (r.changes === 0) throw new Error("link not found");
  return (await getLink(db, from, to))!;
}

/** Statements that delete links and leave tombstones (so deletions sync). */
export function deleteLinksStatements(links: Pick<Link, "from" | "to">[], deletedAt = now()): Statement[] {
  const unique = [...new Map(links.map((l) => [tombstoneId(l.from, l.to), l])).values()];
  return unique.flatMap((l) => [
    { params: [l.from, l.to], sql: "DELETE FROM links WHERE from_track = ? AND to_track = ?" },
    {
      params: [tombstoneId(l.from, l.to), deletedAt],
      sql: `INSERT INTO tombstones (kind, id, deleted_at) VALUES ('link', ?, ?)
            ON CONFLICT (kind, id) DO UPDATE SET deleted_at = excluded.deleted_at`,
    },
  ]);
}

/** Delete a link. Returns it, so the caller can offer Undo (`restoreLinks`). */
export async function deleteLink(db: Db, from: string, to: string): Promise<Link | undefined> {
  const link = await getLink(db, from, to);
  if (link) await db.execute(deleteLinksStatements([link]));
  return link;
}

/**
 * Undo deletions: put links back as they were and drop their tombstones. The new
 * `updated_at` makes the restore win over the deletion in sync. Links whose tracks
 * are gone, or that were re-created meanwhile, are left as they are.
 */
export async function restoreLinks(db: Db, links: Link[]): Promise<void> {
  if (links.length === 0) return;
  const ts = now();
  const bothTracks = "EXISTS (SELECT 1 FROM tracks WHERE key = ?) AND EXISTS (SELECT 1 FROM tracks WHERE key = ?)";
  await db.execute(
    links.flatMap((l) => [
      {
        params: [tombstoneId(l.from, l.to), l.from, l.to, l.from, l.to],
        sql: `DELETE FROM tombstones WHERE kind = 'link' AND id = ?
              AND NOT EXISTS (SELECT 1 FROM links WHERE from_track = ? AND to_track = ?) AND ${bothTracks}`,
      },
      {
        params: [l.from, l.to, l.comment, l.rating, l.tags, l.createdAt, ts, l.from, l.to],
        sql: `INSERT INTO links (${COLUMNS}) SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${bothTracks}
              ON CONFLICT DO NOTHING`,
      },
    ]),
  );
}
