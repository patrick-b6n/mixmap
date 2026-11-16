/**
 * Minimal SQL client – the shape of `tauri-plugin-sql`'s `Database`. The app
 * implements it with the plugin (`tauri-sql-client.ts`), tests with
 * `better-sqlite3` (`__tests__/better-sqlite3-client.ts`). Everything above it
 * (connection lock, migrator, Drizzle adapter) is the same in both.
 */

/** Values that can be bound to a statement. */
export type SqlValue = string | number | null;

/** A result row, keyed by column name (as the plugin returns it). */
export type SqlRow = Record<string, unknown>;

export interface ExecuteResult {
  rowsAffected: number;
  lastInsertId?: number;
}

export interface SqlClient {
  /** Runs a statement that returns no rows. */
  execute(sql: string, params?: readonly SqlValue[]): Promise<ExecuteResult>;
  /** Runs a statement and returns its rows (also for `INSERT … RETURNING`). */
  select(sql: string, params?: readonly SqlValue[]): Promise<SqlRow[]>;
}

/** Error raised by the database (wraps the plugin's string errors). */
export class SqlError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SqlError";
  }
}
