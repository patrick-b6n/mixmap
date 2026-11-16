import { openDatabase, type OpenDatabaseOptions } from "../open-database";
import { createNodeSqliteClient, memorySqlite } from "./node-sqlite-client";

/**
 * Fresh in-memory database with all committed migrations applied – through
 * the app's own path: {@link openDatabase} with the legacy adoption, the
 * migrator and the Drizzle `sqlite-proxy` adapter; only the plugin is replaced
 * by `node:sqlite`. One per test keeps tests isolated.
 *
 * - `database` (Drizzle) / `sql` (raw SQL): as the repositories get them in the app,
 * - `sqlite`: raw `node:sqlite` handle for setup and assertions.
 */
export async function createTestDb(options: OpenDatabaseOptions = {}) {
  const sqlite = memorySqlite();
  const { database, sql } = await openDatabase(createNodeSqliteClient(sqlite), options);
  return { database, db: database.db, sql, sqlite };
}

/**
 * Awaits a query that must fail and returns its error messages including all
 * causes – Drizzle wraps database errors in a `DrizzleQueryError` whose own
 * message only names the query.
 */
export async function dbError(query: PromiseLike<unknown>): Promise<string> {
  try {
    await query;
  } catch (error) {
    const messages: string[] = [];
    for (let current: unknown = error; current !== undefined;) {
      messages.push(current instanceof Error ? current.message : String(current));
      current = current instanceof Error ? current.cause : undefined;
    }
    return messages.join("\n");
  }
  throw new Error("Expected the query to fail, but it succeeded");
}
