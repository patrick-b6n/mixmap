import { Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Placeholder } from "@/components/Placeholder";
import { Button } from "@/components/ui/button";
import { addNodeStatements, type BoardNode, listNodes, moveNodes } from "../db/boards";
import { apiDb } from "../db/db";
import { createLinkStatements } from "../db/links";
import { portableKey } from "../domain/matching";
import { centeredAt, placeNextTo } from "../domain/placement";
import { BoardTabs, nextBoardName } from "./BoardTabs";
import type { TrackDrop } from "./dnd";
import { GraphCanvas } from "./GraphCanvas";
import { useBoards } from "./useBoards";
import type { MixmapData } from "./useMixmap";

type Props = { artworkVersion: number; data: MixmapData };

/** Upper center area: board tabs and the graph canvas of the active board. */
export function GraphPanel({ artworkVersion, data }: Props) {
  const state = useBoards();
  const [error, setError] = useState<string>();
  const [nodes, setNodes] = useState<{ boardId: string; nodes: BoardNode[] }>();
  const boardId = state.active?.id;
  const shownError = error ?? state.error;
  const current = nodes && nodes.boardId === boardId ? nodes.nodes : undefined;

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

  const onMoved = (positions: { trackKey: string; x: number; y: number }[]) => {
    if (boardId) moveNodes(apiDb, boardId, positions).catch((e) => setError(String(e)));
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b bg-card">
        <BoardTabs onError={setError} state={state} />
      </div>
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
                key={boardId}
                nodes={current}
                onDropTrack={(d) => void onDropTrack(d)}
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
