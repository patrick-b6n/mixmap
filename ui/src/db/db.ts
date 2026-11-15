import { call } from "../api";

/** SQL parameter: stored as-is; arrays/objects are stored as JSON text. */
export type SqlValue = boolean | null | number | string | unknown[] | Record<string, unknown>;

export type Statement = { params?: SqlValue[]; sql: string };

export type ExecResult = { changes: number; lastInsertRowid: number };

/**
 * mixmap's database (mixmap.db). The backend is a thin SQLite bridge; schema,
 * migrations and queries all live in TypeScript.
 */
export interface Db {
  /** Run statements in one transaction: all or nothing. */
  execute(statements: Statement[]): Promise<ExecResult[]>;
  query<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
}

/** The app's database, through the API adapter (devserver HTTP or Tauri). */
export const apiDb: Db = {
  execute: (statements) => call<ExecResult[]>("db_execute", { statements }),
  query: <T>(sql: string, params: SqlValue[] = []) => call<T[]>("db_query", { params, sql }),
};

/** Milliseconds since the epoch; every row carries created/updated timestamps. */
export const now = (): number => Date.now();

/** New random id for rows that sync between machines. */
export const newId = (): string => crypto.randomUUID();
