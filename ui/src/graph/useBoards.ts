import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import * as boards from "../db/boards";
import type { Board } from "../db/boards";
import { apiDb } from "../db/db";
import { startDatabaseOnce } from "../db/startup";

const ACTIVE_KEY = "mixmap.activeBoard";

function loadActive(): string | undefined {
  try {
    return localStorage.getItem(ACTIVE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function saveActive(id: string | undefined): void {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    // not remembered
  }
}

export type BoardsState = {
  active?: Board;
  boards: Board[];
  /** Create a board, select it and open its name for editing. */
  create: (name: string) => Promise<Board>;
  /** Board whose name is being edited in its tab. */
  editingId?: string;
  error?: string;
  /** False until the first load finished. */
  loaded: boolean;
  remove: (id: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  select: (id: string) => void;
  setEditingId: (id: string | undefined) => void;
};

/**
 * Boards from mixmap.db plus the active one (remembered on this machine). `version`
 * reloads the list when shared data changed (e.g. after an import or sync).
 */
export function useBoards(version = 0): BoardsState {
  const [list, setList] = useState<Board[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeId, setActiveId] = useState<string | undefined>(loadActive);
  const [error, setError] = useState<string>();
  const [editingId, setEditingId] = useState<string>();

  const reload = useCallback(async () => {
    try {
      await startDatabaseOnce(apiDb, api.setLibrarySource);
      setList(await boards.listBoards(apiDb));
      setError(undefined);
    } catch (e) {
      setError(`boards: ${String(e)}`);
    }
  }, []);

  useEffect(() => {
    let live = true;
    startDatabaseOnce(apiDb, api.setLibrarySource)
      .then(() => boards.listBoards(apiDb))
      .then(
        (l) => {
          if (!live) return;
          setList(l);
          setLoaded(true);
        },
        (e) => live && setError(`boards: ${String(e)}`),
      );
    return () => {
      live = false;
    };
    // version is a trigger: reload when shared data changed.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [version]);

  const select = useCallback((id: string) => {
    setActiveId(id);
    saveActive(id);
  }, []);

  const create = useCallback(
    async (name: string) => {
      const board = await boards.createBoard(apiDb, name);
      await reload();
      select(board.id);
      setEditingId(board.id);
      return board;
    },
    [reload, select],
  );

  const rename = useCallback(
    async (id: string, name: string) => {
      await boards.renameBoard(apiDb, id, name);
      await reload();
    },
    [reload],
  );

  const remove = useCallback(
    async (id: string) => {
      const index = list.findIndex((b) => b.id === id);
      await boards.deleteBoard(apiDb, id);
      setEditingId((e) => (e === id ? undefined : e));
      // Select the neighbour of a deleted active board.
      if (id === activeId) {
        const rest = list.filter((b) => b.id !== id);
        const next = rest[Math.min(index, rest.length - 1)];
        setActiveId(next?.id);
        saveActive(next?.id);
      }
      await reload();
    },
    [activeId, list, reload],
  );

  // The remembered board may be gone (deleted, other machine): fall back to the first.
  const active = list.find((b) => b.id === activeId) ?? list[0];
  return { active, boards: list, create, editingId, error, loaded, remove, rename, select, setEditingId };
}
