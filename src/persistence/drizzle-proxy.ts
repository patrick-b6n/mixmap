import type { AsyncBatchRemoteCallback, AsyncRemoteCallback } from "drizzle-orm/sqlite-proxy";

import type { SqlClient, SqlRow, SqlValue } from "./sql-client";

/**
 * Callback for Drizzle's `sqlite-proxy` driver on top of a {@link SqlClient}.
 *
 * - `run` → `execute`; the result carries `rowsAffected`/`lastInsertId`
 *   besides the (empty) `rows`.
 * - `all`/`values` → `select`, each row as an array of its values.
 * - `get` → `select`, the first row as an array (or `undefined`).
 *
 * The plugin returns rows as objects keyed by column name; Drizzle maps
 * values by position. The object keeps the column order – except for
 * integer-like keys, which JS objects always put first (rejected below), and
 * duplicate names, which collapse into one key: **result columns must have
 * unique names**. In joins, alias same-named columns
 * (`sql<number>\`${categories.id}\`.as("category_id")`). The test client
 * (`__tests__/better-sqlite3-client.ts`) rejects duplicates, so persistence
 * tests catch them.
 *
 * Transaction statements are rejected: Drizzle's `db.transaction()` sends
 * `begin`/`commit` as separate calls, which other flows could interleave
 * with. Use `Database.transaction()` (database.ts) instead.
 */
export function createProxyCallback(client: SqlClient): AsyncRemoteCallback {
  return async (sql, params, method) => {
    assertNoTransactionControl(sql);
    const values = toSqlValues(params);
    if (method === "run") {
      const result = await client.execute(sql, values);
      return { rows: [], ...result };
    }
    const rows = (await client.select(sql, values)).map(rowToArray);
    // For `get`, Drizzle expects the single row itself in `rows`.
    return method === "get" ? { rows: rows[0] as unknown as unknown[] } : { rows };
  };
}

/**
 * Batch callback on top of `callback`: runs the queries one after another.
 * Atomicity comes from the caller (database.ts wraps it in a transaction).
 */
export function createBatchCallback(callback: AsyncRemoteCallback): AsyncBatchRemoteCallback {
  return async (queries) => {
    const results = [];
    for (const { sql, params, method } of queries) {
      results.push(await callback(sql, params, method));
    }
    return results;
  };
}

const TRANSACTION_CONTROL = /^\s*(begin|commit|end|rollback|savepoint|release)\b/i;

function assertNoTransactionControl(sql: string) {
  if (TRANSACTION_CONTROL.test(sql)) {
    throw new Error(
      `Transaction statements are not allowed via Drizzle ("${sql.trim()}"); use Database.transaction()`,
    );
  }
}

/** Converts Drizzle's parameters to values the plugin can bind. */
export function toSqlValues(params: readonly unknown[]): SqlValue[] {
  return params.map((value) => {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw new TypeError(`Cannot bind non-finite number ${value}`);
      }
      return value;
    }
    // The plugin would bind a JSON `true` as the text 'true'.
    if (typeof value === "boolean") {
      return value ? 1 : 0;
    }
    throw new TypeError(`Cannot bind value of type ${typeof value} (${String(value)})`);
  });
}

const INTEGER_LIKE = /^(0|[1-9]\d*)$/;

/** Row object → array of values in column order. */
export function rowToArray(row: SqlRow): unknown[] {
  const keys = Object.keys(row);
  // JS orders integer-like keys first, so the column order would be lost.
  if (keys.length > 1 && keys.some((key) => INTEGER_LIKE.test(key))) {
    throw new Error(
      `Result column names must not be integers (got ${keys.join(", ")}); alias the column`,
    );
  }
  return keys.map((key) => row[key]);
}
