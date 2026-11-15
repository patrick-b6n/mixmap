import type { LibrarySource } from "../api";
import type { Db } from "./db";
import { migrate } from "./schema";
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

export async function startDatabase(db: Db, applySource: (source: LibrarySource) => Promise<unknown>): Promise<void> {
  await migrate(db);
  const source = await getSetting<LibrarySource>(db, SETTINGS.librarySource);
  if (source && source.kind !== "auto") await applySource(source);
}
