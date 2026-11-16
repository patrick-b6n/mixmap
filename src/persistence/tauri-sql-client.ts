import Database from "@tauri-apps/plugin-sql";

import { type SqlClient, SqlError } from "./sql-client";

/**
 * Name of the database registered by the Tauri host (src-tauri/src/lib.rs):
 * `mixmap.db` in `%APPDATA%\mixmap` (debug builds: `.dev-data/`).
 */
export const DB_NAME = "sqlite:mixmap.db";

/**
 * {@link SqlClient} on top of `tauri-plugin-sql`.
 *
 * Uses `Database.get` instead of `Database.load`: the host already opened
 * the database with a single connection, and `load` would replace that pool
 * with one of up to ten connections (therefore the app does not have the
 * `sql:allow-load` permission).
 */
export function createTauriSqlClient(): SqlClient {
  const database = Database.get(DB_NAME);
  return {
    execute: async (sql, params = []) => {
      try {
        const result = await database.execute(sql, [...params]);
        return { rowsAffected: result.rowsAffected, lastInsertId: result.lastInsertId };
      } catch (error) {
        throw toSqlError(error, sql);
      }
    },
    select: async (sql, params = []) => {
      try {
        return await database.select<Record<string, unknown>[]>(sql, [...params]);
      } catch (error) {
        throw toSqlError(error, sql);
      }
    },
  };
}

/** The plugin rejects with plain strings; turn them into errors. */
function toSqlError(error: unknown, sql: string): SqlError {
  const message = error instanceof Error ? error.message : String(error);
  return new SqlError(`${message} (SQL: ${sql.trim().slice(0, 200)})`, { cause: error });
}
