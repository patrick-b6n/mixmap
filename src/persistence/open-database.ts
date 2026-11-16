import { loadMigrations } from "./bundled-migrations";
import { SqlConnection } from "./connection";
import { createDatabase, type Database } from "./database";
import { adoptLegacyDatabase, type LegacyBackup } from "./legacy";
import { type MigrateOptions, migrate } from "./migrator";
import type { SqlClient } from "./sql-client";
import { createSqlDb, type SqlDb } from "./sql-db";

export interface OpenDatabaseOptions extends MigrateOptions {
  /** Web Lock shared by all windows (connection.ts); unset in tests. */
  lockName?: string;
  /** Saves a version-1 database before it is upgraded (legacy.ts). */
  legacyBackup?: LegacyBackup;
}

export interface OpenDatabaseResult {
  database: Database;
  /** Raw SQL on the same connection, for the repositories. */
  sql: SqlDb;
  /** Tags of the migrations applied while opening. */
  applied: string[];
}

/**
 * Opens the database on `client`: adopts a pre-Drizzle database, applies all
 * pending migrations and returns the Drizzle-based {@link Database}. The app
 * passes the Tauri client, tests a `node:sqlite` one – both take the same path.
 */
export async function openDatabase(client: SqlClient, options: OpenDatabaseOptions = {}): Promise<OpenDatabaseResult> {
  const connection = new SqlConnection(client, { lockName: options.lockName });
  await resetConnection(connection);
  const migrations = await loadMigrations();
  await adoptLegacyDatabase(connection, migrations, options.legacyBackup ?? refuseLegacyUpgrade);
  const { applied } = await migrate(connection, migrations, options);
  return { database: createDatabase(connection), sql: createSqlDb(connection), applied };
}

async function refuseLegacyUpgrade(): Promise<never> {
  throw new Error("Upgrading a version-1 database needs a backup writer");
}

/**
 * The connection lives in the Tauri host and survives a reload of the
 * WebView. A reload in the middle of a transaction would leave it open, and
 * the next `BEGIN` would fail – so roll back whatever is left. Runs under the
 * cross-window lock, so it never hits the other window's transaction.
 */
async function resetConnection(connection: SqlConnection) {
  try {
    await connection.execute("ROLLBACK");
  } catch (error) {
    if (!/no transaction is active/i.test(String(error))) {
      throw error;
    }
  }
}
