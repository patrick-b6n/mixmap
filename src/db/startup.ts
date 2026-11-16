import type { LibrarySource } from "../api";
import { writeBackupFile } from "./backup";
import type { Db } from "./db";
import { exportVersion1 } from "./legacy";
import { migrate, schemaVersion } from "./schema";
import { getSetting, SETTINGS } from "./settings";

/**
 * Prepare mixmap.db and restore persisted settings that live in the backend:
 * the saved library source is re-applied if it isn't the automatic default.
 */
let started: Promise<void> | undefined;

/** `startDatabase` once per page, however often it is requested (StrictMode). */
export function startDatabaseOnce(db: Db, applySource: (source: LibrarySource) => Promise<unknown>): Promise<void> {
  // A failed start may be retried (e.g. after the backend comes up).
  started ??= startDatabase(db, applySource).catch((e: unknown) => {
    started = undefined;
    throw e;
  });
  return started;
}

/** Saves a backup file's text (`%APPDATA%\mixmap\backups\` in the app). */
export type BackupWriter = (content: string, reason: string) => Promise<unknown>;

export async function startDatabase(
  db: Db,
  applySource: (source: LibrarySource) => Promise<unknown>,
  backup: BackupWriter = writeBackupFile,
): Promise<void> {
  // Version 1 → 2 merges boards into one graph: keep the boards in a backup first.
  // If the backup fails, nothing is migrated.
  if ((await schemaVersion(db)) === 1) {
    await backup(`${JSON.stringify(await exportVersion1(db), null, 2)}\n`, "before-upgrade");
  }
  await migrate(db);
  const source = await getSetting<LibrarySource>(db, SETTINGS.librarySource);
  if (source && source.kind !== "auto") await applySource(source);
}
