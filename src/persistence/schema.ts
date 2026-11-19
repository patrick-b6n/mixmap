import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/**
 * mixmap's own database (`mixmap.db`). Generate a migration after every change
 * with `pnpm db:generate`; never edit a released migration (docs/data-model.md).
 *
 * Identity (so rows merge across machines without collisions):
 * - tracks: the portable key (normalized artist|title|seconds), see business/matching
 * - links: (from_track, to_track), at most one per direction
 * - nodes (cards on the graph): track_key
 * - manual_matches: portable key → this machine's rekordbox id
 *
 * Timestamps are milliseconds since the epoch; `rekordbox_id`/`missing` on tracks
 * are a machine-local cache.
 *
 * Deleting a synced row records a tombstone (kind, id, deleted_at). Tombstone ids:
 * track `<key>`, link `<from>\u0001<to>`, node `<track_key>`, manual_match `<key>`
 * — see `tombstoneId`.
 *
 * Databases created before Drizzle (schema version 2 in `PRAGMA user_version`)
 * have exactly these tables; legacy.ts adopts them as migration `0000_init`.
 */

const timestamps = {
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
};

export const tracks = sqliteTable("tracks", {
  key: text("key").primaryKey(),
  artist: text("artist").notNull(),
  title: text("title").notNull(),
  duration: integer("duration").notNull(),
  rekordboxId: text("rekordbox_id"),
  missing: integer("missing").notNull().default(0),
  ...timestamps,
});

export const links = sqliteTable(
  "links",
  {
    fromTrack: text("from_track")
      .notNull()
      .references(() => tracks.key),
    toTrack: text("to_track")
      .notNull()
      .references(() => tracks.key),
    comment: text("comment").notNull().default(""),
    rating: integer("rating"),
    /** JSON array of strings. */
    tags: text("tags").notNull().default("[]"),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.fromTrack, t.toTrack] }),
    index("links_to_track").on(t.toTrack),
    check("links_rating", sql`${t.rating} BETWEEN 1 AND 5`),
    check("links_not_self", sql`${t.fromTrack} <> ${t.toTrack}`),
  ],
);

/** Cards on the graph. */
export const nodes = sqliteTable("nodes", {
  trackKey: text("track_key")
    .primaryKey()
    .references(() => tracks.key),
  x: real("x").notNull(),
  y: real("y").notNull(),
  ...timestamps,
});

export const manualMatches = sqliteTable("manual_matches", {
  trackKey: text("track_key").primaryKey(),
  rekordboxId: text("rekordbox_id").notNull(),
  ...timestamps,
});

export const tombstones = sqliteTable(
  "tombstones",
  {
    kind: text("kind").notNull(),
    id: text("id").notNull(),
    deletedAt: integer("deleted_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.id] })],
);

/** JSON values by key; keys starting with `local.` belong to this machine. */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
