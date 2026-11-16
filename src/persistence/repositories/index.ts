import type {
  ExchangeRepository,
  LinksRepository,
  NodesRepository,
  SettingsRepository,
  TracksRepository,
} from "@/business/ports";

import type { SqlDb } from "@/persistence/sql-db";
import { exportData, importData, resetData } from "./exchange";
import {
  createLink,
  createLinks,
  createLinkStatements,
  deleteLinksStatements,
  getLink,
  listLinks,
  restoreLinks,
  updateLink,
} from "./links";
import {
  addNodeStatements,
  listNodes,
  moveNodes,
  removeNodeStatements,
  restoreNode,
} from "./nodes";
import { getSetting, setSetting } from "./settings";
import { listTracks, reconcile, setManualMatch } from "./tracks";

export type Repositories = {
  exchange: ExchangeRepository;
  links: LinksRepository;
  nodes: NodesRepository;
  settings: SettingsRepository;
  tracks: TracksRepository;
};

/** The repositories (business/ports.ts) on mixmap.db. */
export function createRepositories(db: SqlDb): Repositories {
  return {
    exchange: {
      export: (library) => exportData(db, library),
      import: (data, mode, library) => importData(db, data, mode, library),
      reset: () => resetData(db),
    },
    links: {
      create: (from, to, init) => createLink(db, from, to, init),
      createMany: (pairs) => createLinks(db, pairs),
      deleteMany: async (links) => {
        if (links.length > 0) await db.execute(deleteLinksStatements(links));
      },
      get: (from, to) => getLink(db, from, to),
      list: () => listLinks(db),
      restore: (links) => restoreLinks(db, links),
      update: (from, to, patch) => updateLink(db, from, to, patch),
    },
    nodes: {
      list: () => listNodes(db),
      move: (positions) => moveNodes(db, positions),
      place: async (placement, link) => {
        const statements = [
          ...(placement
            ? addNodeStatements(placement.track, placement.x, placement.y).statements
            : []),
          ...(link ? createLinkStatements(link.from, link.to).statements : []),
        ];
        if (statements.length > 0) await db.execute(statements);
      },
      remove: async (trackKey, links = []) => {
        await db.execute([...removeNodeStatements(trackKey), ...deleteLinksStatements(links)]);
      },
      restore: (node) => restoreNode(db, node),
    },
    settings: {
      get: (key) => getSetting(db, key),
      set: (key, value) => setSetting(db, key, value),
    },
    tracks: {
      list: () => listTracks(db),
      reconcile: (library) => reconcile(db, library),
      setManualMatch: (trackKey, rekordboxId) => setManualMatch(db, trackKey, rekordboxId),
    },
  };
}
