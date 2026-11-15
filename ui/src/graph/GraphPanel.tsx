import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Placeholder } from "@/components/Placeholder";
import { Button } from "@/components/ui/button";
import { type BoardNode, listNodes, moveNodes } from "../db/boards";
import { apiDb } from "../db/db";
import { BoardTabs, nextBoardName } from "./BoardTabs";
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
            current.length > 0 ? (
              <GraphCanvas
                artworkVersion={artworkVersion}
                data={data}
                key={boardId}
                nodes={current}
                onMoved={onMoved}
              />
            ) : (
              <Placeholder className="flex h-full items-center justify-center">
                Drag tracks from the table onto the board to start.
              </Placeholder>
            )
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
