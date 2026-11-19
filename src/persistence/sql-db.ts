import type { SqlConnection } from "./connection";
import type { SqlValue as ClientValue, SqlClient } from "./sql-client";

/** SQL parameter: stored as-is; booleans as 0/1, arrays/objects as JSON text. */
export type SqlValue = boolean | null | number | string | unknown[] | Record<string, unknown>;

export type Statement = { params?: SqlValue[]; sql: string };

export type ExecResult = { changes: number; lastInsertRowid: number };

/**
 * Raw-SQL access to mixmap.db, used by the repositories: statements run in one
 * transaction, queries return rows keyed by column name. Built on the same
 * serialized connection as Drizzle.
 */
export interface SqlDb {
  /** Run statements in one transaction: all or nothing. */
  execute(statements: Statement[]): Promise<ExecResult[]>;
  query<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
}

export function createSqlDb(connection: SqlConnection): SqlDb {
  return {
    execute: (statements) => connection.transaction((client) => run(client, statements)),
    query: async <T>(sql: string, params: SqlValue[] = []) =>
      (await connection.select(sql, params.map(toClientValue))) as T[],
  };
}

async function run(client: SqlClient, statements: Statement[]): Promise<ExecResult[]> {
  const results: ExecResult[] = [];
  for (const { params = [], sql } of statements) {
    const result = await client.execute(sql, params.map(toClientValue));
    results.push({ changes: result.rowsAffected, lastInsertRowid: result.lastInsertId ?? 0 });
  }
  return results;
}

/** The plugin binds JSON values: booleans would become 'true', arrays a JSON array. */
export function toClientValue(value: SqlValue | undefined): ClientValue {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}
