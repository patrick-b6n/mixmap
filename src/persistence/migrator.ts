import type { Migration } from "./bundled-migrations";
import { begin, rollbackQuietly, type SqlConnection } from "./connection";
import type { SqlClient } from "./sql-client";

/** Tracking table: one row per applied migration. */
export const MIGRATIONS_TABLE = "__migrations";

/** Creates the tracking table if it does not exist yet. */
export async function createMigrationsTable(client: SqlClient): Promise<void> {
  await client.execute(
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      idx INTEGER PRIMARY KEY NOT NULL,
      tag TEXT NOT NULL UNIQUE,
      hash TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )`,
  );
}

export type MigrationErrorCode =
  /** An applied migration's SQL differs from the bundled one (migrations are never edited). */
  | "hash_mismatch"
  /** The database contains a migration the app does not know (DB from a newer version?). */
  | "unknown_migration"
  /** Applied migrations are not a prefix of the bundled ones (order changed). */
  | "order_mismatch"
  /** `PRAGMA foreign_key_check` found violations after migrating. */
  | "foreign_key_violation";

export class MigrationError extends Error {
  readonly code: MigrationErrorCode;

  constructor(code: MigrationErrorCode, message: string) {
    super(message);
    this.name = "MigrationError";
    this.code = code;
  }
}

export interface MigrateOptions {
  /** Clock for `applied_at` (tests). */
  now?: () => Date;
}

export interface MigrateResult {
  /** Tags of the migrations applied by this run, in order. */
  applied: string[];
}

/**
 * Applies all pending migrations in one transaction (docs/data-model.md):
 *
 * 1. `PRAGMA foreign_keys = OFF` – outside the transaction, where SQLite
 *    ignores it; table rebuilds by drizzle-kit need it,
 * 2. `BEGIN`, check the tracking table against the bundled migrations, run
 *    the pending ones and record them,
 * 3. `PRAGMA foreign_key_check` – violations roll everything back,
 * 4. `COMMIT`,
 * 5. `PRAGMA foreign_keys = ON` – also after an error.
 *
 * All of it runs in one exclusive section of the connection, i.e. on the same
 * physical connection without other queries in between.
 */
export function migrate(
  connection: SqlConnection,
  migrations: readonly Migration[],
  options: MigrateOptions = {},
): Promise<MigrateResult> {
  const now = options.now ?? (() => new Date());
  return connection.exclusive(async (client) => {
    await client.execute("PRAGMA foreign_keys = OFF");
    let result: MigrateResult;
    try {
      result = await migrateInTransaction(client, migrations, now);
    } catch (error) {
      // Re-enable foreign keys, but never let a failure doing so mask the
      // error that made the migration fail.
      try {
        await client.execute("PRAGMA foreign_keys = ON");
      } catch {
        // The original error below is what matters; the start fails anyway.
      }
      throw error;
    }
    await client.execute("PRAGMA foreign_keys = ON");
    return result;
  });
}

async function migrateInTransaction(
  client: SqlClient,
  migrations: readonly Migration[],
  now: () => Date,
): Promise<MigrateResult> {
  await begin(client);
  try {
    const applied = await applyPending(client, migrations, now);
    const violations = await client.select("PRAGMA foreign_key_check");
    if (violations.length > 0) {
      throw new MigrationError(
        "foreign_key_violation",
        `Foreign key violations after migration: ${JSON.stringify(violations)}`,
      );
    }
    await client.execute("COMMIT");
    return { applied };
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  }
}

async function applyPending(client: SqlClient, migrations: readonly Migration[], now: () => Date): Promise<string[]> {
  await createMigrationsTable(client);
  const rows = await client.select(`SELECT idx, tag, hash FROM ${MIGRATIONS_TABLE} ORDER BY idx`);
  const applied = rows.map((row) => ({
    idx: Number(row.idx),
    tag: String(row.tag),
    hash: String(row.hash),
  }));
  checkApplied(applied, migrations);

  const pending = migrations.slice(applied.length);
  for (const [offset, migration] of pending.entries()) {
    for (const statement of migration.statements) {
      await client.execute(statement);
    }
    await client.execute(`INSERT INTO ${MIGRATIONS_TABLE} (idx, tag, hash, applied_at) VALUES (?, ?, ?, ?)`, [
      applied.length + offset,
      migration.tag,
      migration.hash,
      now().toISOString(),
    ]);
  }
  return pending.map((migration) => migration.tag);
}

/** The applied migrations must be exactly the first bundled ones, unchanged. */
function checkApplied(
  applied: readonly { idx: number; tag: string; hash: string }[],
  migrations: readonly Migration[],
) {
  const known = new Map(migrations.map((migration) => [migration.tag, migration]));
  for (const [position, row] of applied.entries()) {
    const migration = known.get(row.tag);
    if (!migration) {
      throw new MigrationError(
        "unknown_migration",
        `The database contains migration ${row.tag}, which this version of the app does not know`,
      );
    }
    if (row.idx !== position || migrations[position]?.tag !== row.tag) {
      throw new MigrationError(
        "order_mismatch",
        `Migration ${row.tag} was applied at position ${row.idx}, but is at position ${migrations.indexOf(migration)} now`,
      );
    }
    if (row.hash !== migration.hash) {
      throw new MigrationError("hash_mismatch", `Migration ${row.tag} was changed after it had been applied`);
    }
  }
}
