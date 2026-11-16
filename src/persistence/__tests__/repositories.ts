// Test helpers: mixmap.db in memory, opened through the app's own path
// (persistence/open-database.ts) on node:sqlite instead of the Tauri plugin.
import { createRepositories } from "../repositories";
import { createTestDb } from "./test-db";

export { track } from "@/business/__tests__/fixtures";

/** A migrated in-memory database; `raw` is the node:sqlite handle for setup and assertions. */
export async function testDb() {
  const { sql, sqlite } = await createTestDb();
  return Object.assign(sql, { raw: sqlite });
}

/** The repositories on a fresh in-memory database. */
export async function testRepositories() {
  return createRepositories(await testDb());
}
