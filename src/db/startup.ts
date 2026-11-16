import type { LibrarySource } from "../api";
import type { Db } from "./db";
import { getSetting, SETTINGS } from "./settings";

/**
 * Restore persisted settings that live in the backend: the saved library source is
 * re-applied if it isn't the automatic default. (mixmap.db itself is opened and
 * migrated by `openAppDatabase`.)
 */
export async function restoreSettings(db: Db, applySource: (source: LibrarySource) => Promise<unknown>): Promise<void> {
  const source = await getSetting<LibrarySource>(db, SETTINGS.librarySource);
  if (source && source.kind !== "auto") await applySource(source);
}
