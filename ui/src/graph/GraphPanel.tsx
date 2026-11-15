import { Network, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Placeholder } from "@/components/Placeholder";
import { Button } from "@/components/ui/button";
import { addNodeStatements, type BoardNode, listNodes, moveNodes, removeNode, restoreNode } from "../db/boards";
import { apiDb } from "../db/db";
import { createLink, createLinkStatements, listLinks } from "../db/links";
import { type GraphFilter, isActive, matchingNodes } from "../domain/filters";
import { buildGraph } from "../domain/graph";
import { portableKey } from "../domain/matching";
import { centeredAt, placeNextTo } from "../domain/placement";
import { BoardTabs, nextBoardName } from "./BoardTabs";
import { FilterBar } from "./FilterBar";
import type { TrackDrop } from "./dnd";
import { GraphCanvas } from "./GraphCanvas";
import { useBoards } from "./useBoards";
import type { LinkActions } from "./useLinkActions";
import type { MixmapData } from "./useMixmap";

type Props = {
  actions: LinkActions;
  locate?: { n: number; trackId: string };
  onSelectTrack: (trackId: string | undefined) => void;
  selectedTrackId?: string;
  artworkVersion: number;
  data: MixmapData;
  onDeleteLink: (from: string, to: string) => void;
  onSelectLink: (link: { from: string; to: string } | undefined) => void;
  selectedLink?: { from: string; to: string };
};

/** Upper center area: board tabs and the graph canvas of the active board. */
export function GraphPanel({
  actions,
  artworkVersion,
  data,
  locate,
  onDeleteLink,
  onSelectLink,
  onSelectTrack,
  selectedLink,
  selectedTrackId,
}: Props) {
  /** Links counted when the confirmation opened: exactly these get deleted. */
  const [confirmDeleteAll, setConfirmDeleteAll] = useState<{ links: { from: string; to: string }[]; title: string }>();
  const state = useBoards();
  const [error, setError] = useState<string>();
  const [nodes, setNodes] = useState<{ boardId: string; nodes: BoardNode[] }>();
  const boardId = state.active?.id;
  // A link selected on another board is not shown here: clear the selection.
  const [selectionBoard, setSelectionBoard] = useState(boardId);
  if (selectionBoard !== boardId) {
    setSelectionBoard(boardId);
    if (selectedLink) onSelectLink(undefined);
  }
  const shownError = error ?? state.error;
  const current = nodes && nodes.boardId === boardId ? nodes.nodes : undefined;

  // Graph filters: shared by all boards, never applied to the table.
  const [filter, setFilter] = useState<GraphFilter>({});
  const [hideUnmatched, setHideUnmatched] = useState(false);
  const matched = useMemo(() => {
    if (!current || !isActive(filter)) return undefined;
    const { nodes: cards } = buildGraph(current, data.links, data.tracks, data.library);
    return matchingNodes(filter, cards, data.links);
  }, [current, filter, data.links, data.tracks, data.library]);

  // Nodes of the active board; reloaded when shared data changes (e.g. new links).
  useEffect(() => {
    if (!boardId) return;
    let live = true;
    listNodes(apiDb, boardId).then(
      (n) => live && setNodes({ boardId, nodes: n }),
      (e) => live && setError(String(e)),
    );
    return () => {
      live = false;
    };
    // data.version is a trigger: reload when shared data changed.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [boardId, data.version]);

  /**
   * Table track dropped on the canvas. Onto a node: link node → track (Alt: track →
   * node) and place the track beside the node if it isn't on the board yet. Onto
   * empty canvas: just add it there. No popup either way.
   */
  const dropping = useRef(false);
  const onDropTrack = async ({ onto, position, positions, reverse, trackId }: TrackDrop) => {
    const track = data.library.get(trackId);
    if (!boardId || !track || dropping.current) return;
    const key = portableKey(track);
    if (onto === key) return;
    const onBoard = positions.some((n) => n.key === key);
    const statements = [];
    try {
      if (onto) {
        const anchor = positions.find((n) => n.key === onto);
        if (!onBoard && anchor) {
          const p = placeNextTo(anchor, positions, reverse ? "left" : "right");
          statements.push(...addNodeStatements(boardId, track, p.x, p.y).statements);
        }
        statements.push(
          ...(reverse ? createLinkStatements(track, onto) : createLinkStatements(onto, track)).statements,
        );
      } else if (!onBoard) {
        const p = centeredAt(position);
        statements.push(...addNodeStatements(boardId, track, p.x, p.y).statements);
      }
      if (statements.length === 0) return;
      dropping.current = true;
      // Node and link in one transaction: never a node without its link.
      await apiDb.execute(statements);
      data.refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      dropping.current = false;
    }
  };

  const onLink = (source: string, target: string) => {
    createLink(apiDb, source, target).then(data.refresh, (e) => setError(String(e)));
  };

  /** "Remove from board": the track's links stay; Undo puts it back where it was. */
  const onRemoveFromBoard = (trackKey: string) => {
    if (!boardId) return;
    if (selectedLink && (selectedLink.from === trackKey || selectedLink.to === trackKey)) onSelectLink(undefined);
    actions
      .run(async () => {
        // Re-read: Undo must restore the stored position (drags are saved async).
        const node = (await listNodes(apiDb, boardId)).find((n) => n.trackKey === trackKey);
        if (!node) return;
        await removeNode(apiDb, boardId, trackKey);
        data.refresh();
        const entry = {
          label: "remove from board",
          undo: async () => {
            if (!(await restoreNode(apiDb, node))) throw new Error("the track or board no longer exists");
          },
        };
        actions.undo.push(entry);
        toast("Removed from board", {
          action: {
            label: "Undo",
            onClick: () =>
              void actions.run(() => actions.undo.undoEntry(entry)).then(data.refresh, (e) => setError(String(e))),
          },
        });
      })
      .catch((e) => setError(String(e)));
  };

  /** "Delete all links of this track": confirm with the count first. */
  const onDeleteAllLinks = (trackKey: string) => {
    const links = data.links
      .filter((l) => l.from === trackKey || l.to === trackKey)
      .map((l) => ({ from: l.from, to: l.to }));
    const t = data.tracks.get(trackKey);
    if (links.length > 0) setConfirmDeleteAll({ links, title: t ? `${t.artist} – ${t.title}` : trackKey });
  };

  /** Bumped after an auto-layout: remounts the canvas so it shows the new positions. */
  const [layoutRun, setLayoutRun] = useState<Record<string, number>>({});
  const bumpLayout = (id: string) => setLayoutRun((r) => ({ ...r, [id]: (r[id] ?? 0) + 1 }));
  const [layingOut, setLayingOut] = useState(false);

  /** ELK auto-layout of the whole board, saved at once; Ctrl+Z restores the old positions. */
  const onAutoLayout = () => {
    if (!boardId || !current || current.length === 0) return;
    setLayingOut(true);
    actions
      .run(async () => {
        // ELK is large: load it on first use.
        const { autoLayout } = await import("../domain/layout");
        const before = await listNodes(apiDb, boardId);
        // Current links, not the ones captured at click time (the task may have waited).
        const positions = await autoLayout(
          before.map((n) => n.trackKey),
          await listLinks(apiDb),
        );
        await moveNodes(
          apiDb,
          boardId,
          positions.map((p) => ({ trackKey: p.key, x: p.x, y: p.y })),
        );
        // Show the new positions right away (the canvas remounts from this list).
        const laidOut = new Map(positions.map((p) => [p.key, p]));
        setNodes({
          boardId,
          nodes: before.map((n) => ({
            ...n,
            x: laidOut.get(n.trackKey)?.x ?? n.x,
            y: laidOut.get(n.trackKey)?.y ?? n.y,
          })),
        });
        bumpLayout(boardId);
        data.refresh();
        actions.undo.push({
          label: "auto-layout",
          undo: async () => {
            await moveNodes(apiDb, boardId, before);
            setNodes({ boardId, nodes: await listNodes(apiDb, boardId) });
            bumpLayout(boardId);
          },
        });
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLayingOut(false));
  };

  const onLocateMissing = useCallback(() => {
    toast(`Not on “${state.active?.name ?? "this board"}” — drag it from the table to add it.`);
  }, [state.active?.name]);

  const onMoved = (positions: { trackKey: string; x: number; y: number }[]) => {
    if (boardId) moveNodes(apiDb, boardId, positions).catch((e) => setError(String(e)));
  };

  return (
    <div className="flex h-full flex-col">
      {confirmDeleteAll && (
        <ConfirmDialog
          confirmLabel={`Delete ${confirmDeleteAll.links.length} link${confirmDeleteAll.links.length === 1 ? "" : "s"}`}
          description={`All ${confirmDeleteAll.links.length} incoming and outgoing link${
            confirmDeleteAll.links.length === 1 ? "" : "s"
          } of “${confirmDeleteAll.title}” will be deleted, on every board. You can undo this right after.`}
          onCancel={() => setConfirmDeleteAll(undefined)}
          onConfirm={() => {
            const { links } = confirmDeleteAll;
            setConfirmDeleteAll(undefined);
            if (selectedLink && links.some((l) => l.from === selectedLink.from && l.to === selectedLink.to)) {
              onSelectLink(undefined);
            }
            actions.deleteLinks(links).catch((e) => setError(String(e)));
          }}
          title="Delete all links of this track?"
        />
      )}
      <div className="border-b bg-card">
        <div className="flex items-end">
          <div className="min-w-0 flex-1">
            <BoardTabs onError={setError} state={state} />
          </div>
          {current && current.length > 1 && (
            <Button
              className="mr-1 mb-1"
              disabled={layingOut}
              onClick={onAutoLayout}
              title="Arrange the board left to right (Ctrl+Z to undo)"
            >
              <Network />
              {layingOut ? "Arranging…" : "Auto-layout"}
            </Button>
          )}
        </div>
      </div>
      {state.active && (
        <FilterBar
          filter={filter}
          hide={hideUnmatched}
          matched={matched?.size ?? current?.length ?? 0}
          onChange={setFilter}
          onHideChange={setHideUnmatched}
          total={current?.length ?? 0}
        />
      )}
      {shownError && (
        <div className="flex items-center gap-2 border-b px-3 py-1 text-destructive" role="alert">
          <span className="flex-1">{shownError}</span>
          {error && (
            <Button aria-label="Dismiss" onClick={() => setError(undefined)} size="icon-compact" variant="ghost">
              <X />
            </Button>
          )}
        </div>
      )}
      <div className="relative min-h-0 flex-1" id="board-panel" role="tabpanel">
        {!state.loaded ? (
          <Placeholder>Loading…</Placeholder>
        ) : state.active ? (
          current ? (
            <>
              <GraphCanvas
                artworkVersion={artworkVersion}
                data={data}
                hideUnmatched={hideUnmatched}
                matched={matched}
                key={`${boardId}#${layoutRun[boardId ?? ""] ?? 0}`}
                nodes={current}
                locate={locate}
                onDeleteAllLinks={onDeleteAllLinks}
                onDeleteLink={onDeleteLink}
                onDropTrack={(d) => void onDropTrack(d)}
                onLocateMissing={onLocateMissing}
                onLink={onLink}
                onRemoveFromBoard={onRemoveFromBoard}
                onSelectLink={onSelectLink}
                onSelectTrack={onSelectTrack}
                selectedLink={selectedLink}
                selectedTrackId={selectedTrackId}
                onMoved={onMoved}
              />
              {current.length === 0 && (
                <Placeholder className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  Drag tracks from the table onto the board to start.
                </Placeholder>
              )}
            </>
          ) : (
            <Placeholder>Loading…</Placeholder>
          )
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <span>No boards yet. A board holds a set of tracks and their links.</span>
            <Button onClick={() => void state.create(nextBoardName(state.boards)).catch((e) => setError(String(e)))}>
              <Plus />
              Create board
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
