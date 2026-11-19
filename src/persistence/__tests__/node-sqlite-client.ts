import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import { type SqlClient, SqlError, type SqlRow } from "@/persistence/sql-client";

/**
 * {@link SqlClient} on top of Node's built-in `node:sqlite`, behaving like
 * `tauri-plugin-sql`: rows as objects keyed by column name, errors as
 * {@link SqlError}. Unlike the plugin it rejects results with duplicate column
 * names – there the plugin would silently drop values (drizzle-proxy.ts).
 */
export function createNodeSqliteClient(sqlite: DatabaseSync): SqlClient {
  return {
    execute: async (sql, params = []) => {
      const result = wrap(sql, () => sqlite.prepare(sql).run(...(params as SQLInputValue[])));
      return { rowsAffected: Number(result.changes), lastInsertId: Number(result.lastInsertRowid) };
    },
    select: async (sql, params = []) =>
      wrap(sql, () => {
        const statement = sqlite.prepare(sql);
        const names = statement.columns().map((column) => column.name);
        if (names.length === 0) {
          statement.run(...(params as SQLInputValue[]));
          return [];
        }
        const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
        if (duplicates.length > 0) {
          throw new Error(
            `Duplicate result column names (${duplicates.join(", ")}) – tauri-plugin-sql would drop values; alias them`,
          );
        }
        return statement.all(...(params as SQLInputValue[])) as SqlRow[];
      }),
  };
}

/** A fresh in-memory SQLite database (foreign keys on, like the host's connection). */
export function memorySqlite(): DatabaseSync {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  return sqlite;
}

function wrap<T>(sql: string, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SqlError(`${message} (SQL: ${sql.trim().slice(0, 200)})`, { cause: error });
  }
}
