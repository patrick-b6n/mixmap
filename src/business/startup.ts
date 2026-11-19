import type { LibrarySource } from "./model";
import type { SettingsRepository } from "./ports";
import { SETTINGS } from "./settings";

/**
 * Restore persisted settings that live in the backend: the saved library source is
 * re-applied if it isn't the automatic default.
 */
export async function restoreSettings(
  settings: SettingsRepository,
  applySource: (source: LibrarySource) => Promise<unknown>,
): Promise<void> {
  const source = await settings.get<LibrarySource>(SETTINGS.librarySource);
  if (source && source.kind !== "auto") await applySource(source);
}
