import type { SqlDb } from "@/persistence/sql-db";

export type { ExecResult, SqlValue, Statement } from "@/persistence/sql-db";

/** mixmap's database (mixmap.db): raw SQL over the app's single connection. */
export type Db = SqlDb;

/** Milliseconds since the epoch; every row carries created/updated timestamps. */
export const now = (): number => Date.now();

/** New random id for rows that sync between machines. */
export const newId = (): string => crypto.randomUUID();
