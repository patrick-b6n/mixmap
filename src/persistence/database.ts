import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";

import type { SqlConnection } from "./connection";
import { createBatchCallback, createProxyCallback } from "./drizzle-proxy";
import * as schema from "./schema";
import type { SqlClient } from "./sql-client";

/** Drizzle instance over the plugin (`sqlite-proxy`), with the schema for relational queries. */
export type Db = SqliteRemoteDatabase<typeof schema>;

/**
 * The app's database: what repositories are built on.
 *
 * Use {@link Database.transaction} for transactions, never
 * `db.transaction()` (rejected by the proxy callback, see drizzle-proxy.ts).
 * Inside the callback only use `tx` – the outer `db` waits for the
 * transaction to finish and would deadlock.
 */
export interface Database {
  readonly db: Db;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

export function createDatabase(connection: SqlConnection): Database {
  const callback = createProxyCallback(connection);
  // A batch is atomic: one transaction on the connection.
  const batch: Parameters<typeof drizzle>[1] = (queries) =>
    connection.transaction((client) => createBatchCallback(createProxyCallback(client))(queries));
  return {
    db: drizzle(callback, batch, { schema }),
    transaction: (fn) => connection.transaction((client) => fn(transactionDb(client))),
  };
}

/** Drizzle instance bound to the client of a running transaction. */
function transactionDb(client: SqlClient): Db {
  const callback = createProxyCallback(client);
  return drizzle(callback, createBatchCallback(callback), { schema });
}
