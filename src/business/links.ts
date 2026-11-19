import { LinkError } from "./errors";
import type { Track } from "./model";

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

export function checkRating(rating: number | null | undefined): void {
  if (
    rating !== null &&
    rating !== undefined &&
    !(Number.isInteger(rating) && rating >= 1 && rating <= 5)
  ) {
    throw new LinkError("bad_rating", { rating: String(rating) });
  }
}

/** A rekordbox track (added to mixmap.db if needed) or the key of a stored track. */
export type Endpoint = Track | string;
