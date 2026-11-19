import { writeBackup } from "@/business/backup";
import type { Backend, LibraryById } from "@/business/ports";
import { restoreSettings } from "@/business/startup";
import { answerSync, syncNow } from "@/business/sync";
import { createRepositories, type Repositories } from "@/persistence/repositories";
import type { SqlDb } from "@/persistence/sql-db";

/**
 * Everything the UI works with: the repositories on mixmap.db, the Rust backend,
 * and the business services built on both. Created once per window (composition
 * root, app-services.tsx).
 */
export type AppServices = Repositories & {
  backend: Backend;
  /** Backup of all mixmap data before a destructive action; returns its path. */
  backup: (library: LibraryById, reason: "before-import" | "before-reset") => Promise<string>;
  /** Re-applies the saved library source (at startup). */
  restoreSettings: () => Promise<void>;
  sync: {
    /** "Sync now" with a paired device. */
    now: (peerId: string, library: LibraryById) => ReturnType<typeof syncNow>;
    /** Answer another device's sync request. */
    answer: (library: LibraryById, incoming: unknown) => ReturnType<typeof answerSync>;
  };
};

export function createAppServices(db: SqlDb, backend: Backend): AppServices {
  const repositories = createRepositories(db);
  return {
    ...repositories,
    backend,
    backup: (library, reason) => writeBackup(repositories.exchange, backend, library, reason),
    restoreSettings: () => restoreSettings(repositories.settings, backend.setLibrarySource),
    sync: {
      answer: (library, incoming) => answerSync(repositories.exchange, library, incoming),
      now: (peerId, library) =>
        syncNow(repositories.exchange, library, (data) => backend.syncExchange(peerId, data)),
    },
  };
}
