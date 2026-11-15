import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Placeholder } from "@/components/Placeholder";
import { Button } from "@/components/ui/button";
import { BoardTabs, nextBoardName } from "./BoardTabs";
import { useBoards } from "./useBoards";

/** Upper center area: board tabs and the graph canvas of the active board. */
export function GraphPanel() {
  const state = useBoards();
  const [error, setError] = useState<string>();
  const shownError = error ?? state.error;

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
        {state.active ? (
          <Placeholder>Graph of “{state.active.name}”</Placeholder>
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
