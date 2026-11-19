import { writeBackupFile } from "@/business/backup";
import { openDatabase, type OpenDatabaseResult } from "@/persistence/open-database";
import { createTauriSqlClient, DB_NAME } from "@/persistence/tauri-sql-client";

import { backend } from "./backend";

let opened: Promise<OpenDatabaseResult> | undefined;

/**
 * Opens mixmap.db once per window: adopts a database from before Drizzle,
 * applies pending migrations. Both windows (main and overlay) share the host's
 * single connection; the Web Lock named after the database keeps their
 * statements and transactions apart (persistence/connection.ts).
 */
export function openAppDatabase(): Promise<OpenDatabaseResult> {
  opened ??= openDatabase(createTauriSqlClient(), {
    lockName: DB_NAME,
    // Version 1 → 2 merges boards into one graph: keep the boards in a backup first.
    legacyBackup: (snapshot) =>
      writeBackupFile(backend, `${JSON.stringify(snapshot, null, 2)}\n`, "before-upgrade"),
  }).catch((error: unknown) => {
    // A failed start may be retried (e.g. after "Retry" on the error screen).
    opened = undefined;
    throw error;
  });
  return opened;
}
