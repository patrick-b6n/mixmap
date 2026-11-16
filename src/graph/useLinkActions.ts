import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { appDb } from "@/app/database";
import { deleteLinksStatements, getLink, type Link, type LinkPatch, restoreLinks, updateLink } from "../db/links";
import { isTyping, TaskQueue, UndoStack } from "../domain/undo";

/** A patch, or a function computing it from the link as currently stored. */
export type LinkUpdate = LinkPatch | ((current: Link) => LinkPatch);

export type LinkActions = {
  /** Delete links (no confirmation); Ctrl+Z or the toast's Undo restores them. */
  deleteLinks: (links: Pick<Link, "from" | "to">[]) => Promise<void>;
  /** Run an action through the same queue (keeps writes in order). */
  run: <T>(task: () => Promise<T>) => Promise<T>;
  /** Undo stack shared by all undoable graph actions. */
  undo: UndoStack;
  updateLink: (from: string, to: string, update: LinkUpdate) => Promise<Link>;
};

/**
 * Link mutations with undo. All of them run one after another, so a pending
 * comment save always lands before a delete, and functional updates (tags) see
 * the result of the previous one. `refresh` reloads shared data afterwards.
 */
export function useLinkActions(refresh: () => void, onError: (message: string) => void): LinkActions {
  const [undo] = useState(() => new UndoStack());
  const [queue] = useState(() => new TaskQueue());
  const run = useCallback(<T>(task: () => Promise<T>) => queue.run(task), [queue]);

  const undoAndReport = useCallback(
    (perform: () => Promise<boolean | string | undefined>) =>
      run(perform).then(
        (r) => {
          refresh();
          if (r === undefined || r === false) return;
          toast(typeof r === "string" ? `Undone: ${r}` : "Undone");
        },
        (err) => onError(`Undo failed: ${String(err)}`),
      ),
    [run, refresh, onError],
  );

  // Ctrl+Z undoes the last graph action (not while typing: that's the field's undo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z" || e.shiftKey || isTyping(e.target)) return;
      e.preventDefault();
      void undoAndReport(() => undo.undoLast());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, undoAndReport]);

  const deleteLinks = useCallback(
    (keys: Pick<Link, "from" | "to">[]) =>
      run(async () => {
        // Re-read: undo must restore what is stored now, not a stale copy.
        const links = (await Promise.all(keys.map((k) => getLink(appDb, k.from, k.to)))).filter(
          (l): l is Link => l !== undefined,
        );
        if (links.length === 0) return;
        await appDb.execute(deleteLinksStatements(links));
        refresh();
        const label = links.length === 1 ? "Link deleted" : `${links.length} links deleted`;
        const entry = {
          label: label.toLowerCase(),
          undo: async () => {
            const restored = await restoreLinks(appDb, links);
            if (restored < links.length) {
              onError(`${links.length - restored} link(s) could not be restored: their tracks are gone`);
            }
          },
        };
        undo.push(entry);
        toast(label, {
          action: { label: "Undo", onClick: () => void undoAndReport(() => undo.undoEntry(entry)) },
        });
      }),
    [run, undo, refresh, onError, undoAndReport],
  );

  const update = useCallback(
    (from: string, to: string, u: LinkUpdate) =>
      run(async () => {
        const patch = typeof u === "function" ? u((await getLink(appDb, from, to)) ?? notFound()) : u;
        const link = await updateLink(appDb, from, to, patch);
        refresh();
        return link;
      }),
    [run, refresh],
  );

  return { deleteLinks, run, undo, updateLink: update };
}

function notFound(): never {
  throw new Error("link not found");
}
