import { exportFileName, serializeExport } from "./exchange";
import type { Backend, ExchangeRepository, LibraryById } from "./ports";

/**
 * Export everything into the backups folder (`%APPDATA%\mixmap\backups`) before a
 * destructive action (import "replace", reset). Returns the backup's full path.
 */
export async function writeBackup(
  exchange: ExchangeRepository,
  backend: Pick<Backend, "writeBackup">,
  library: LibraryById,
  reason: "before-import" | "before-reset",
): Promise<string> {
  return writeBackupFile(backend, serializeExport(await exchange.export(library)), reason);
}

/** Write an already serialized backup (e.g. a snapshot of an older schema). */
export function writeBackupFile(
  backend: Pick<Backend, "writeBackup">,
  content: string,
  reason: string,
): Promise<string> {
  return backend.writeBackup(content, exportFileName(new Date(), `backup-${reason}`));
}
