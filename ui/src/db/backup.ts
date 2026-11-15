import { call } from "../api";
import type { TrackIdentity } from "../domain/matching";
import type { Db } from "./db";
import { exportData, exportFileName, serializeExport } from "./exchange";

/**
 * Export everything into `%APPDATA%\mixmap\backups\` before a destructive action
 * (import "replace", reset). Returns the backup's full path.
 */
export async function writeBackup(
  db: Db,
  library: ReadonlyMap<string, TrackIdentity>,
  reason: "before-import" | "before-reset",
): Promise<string> {
  const content = serializeExport(await exportData(db, library));
  const name = exportFileName(new Date(), `backup-${reason}`);
  const { path } = await call<{ path: string }>("write_backup", { content, name });
  return path;
}
