// Test helpers: mixmap.db in memory, opened through the app's own path
// (persistence/open-database.ts) on node:sqlite instead of the Tauri plugin.
import type { Track } from "../api";
import { createTestDb } from "@/persistence/__tests__/test-db";

/** A migrated in-memory database; `raw` is the node:sqlite handle for setup and assertions. */
export async function testDb() {
  const { sql, sqlite } = await createTestDb();
  return Object.assign(sql, { raw: sqlite });
}

/** A rekordbox track for tests. */
export const track = (id: string, artist: string, title: string, length = 300): Track => ({
  album: "",
  artist,
  artworkPath: null,
  bpm: 128,
  comment: "",
  filePath: "",
  genre: "",
  id,
  key: "8A",
  length,
  rating: 0,
  title,
});
