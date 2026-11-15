import { MoreHorizontal, Plus } from "lucide-react";
import { type KeyboardEvent, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Board } from "../db/boards";
import type { BoardsState } from "./useBoards";

/** Next free default name: "Board 1", "Board 2", … */
export function nextBoardName(boards: Pick<Board, "name">[]): string {
  const names = new Set(boards.map((b) => b.name));
  let n = boards.length + 1;
  while (names.has(`Board ${n}`)) n++;
  return `Board ${n}`;
}

/** Tab strip above the graph: switch, create, rename (double-click) and delete boards. */
export function BoardTabs({ state, onError }: { onError: (message: string) => void; state: BoardsState }) {
  const editing = state.editingId;
  const setEditing = state.setEditingId;
  const [draft, setDraft] = useState("");
  // Opening a name for editing (also right after "create") starts from its current name.
  const [draftFor, setDraftFor] = useState<string>();
  if (editing !== draftFor) {
    setDraftFor(editing);
    setDraft(state.boards.find((b) => b.id === editing)?.name ?? "");
  }
  /** Set once an edit was committed or cancelled, so the blur that follows is ignored. */
  const finished = useRef(false);
  const [confirmDelete, setConfirmDelete] = useState<Board>();

  const run = (p: Promise<unknown>) => p.catch((e: unknown) => onError(String(e)));

  const startRename = (b: Board) => {
    finished.current = false;
    setEditing(b.id);
  };

  const commitRename = () => {
    if (finished.current) return;
    finished.current = true;
    const id = editing;
    setEditing(undefined);
    const board = state.boards.find((b) => b.id === id);
    if (board && draft.trim() && draft.trim() !== board.name) void run(state.rename(board.id, draft));
  };

  const cancelRename = () => {
    finished.current = true;
    setEditing(undefined);
  };

  const onRenameKey = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === "Enter") commitRename();
    if (e.key === "Escape") cancelRename();
  };

  /** Tab keys: Enter/Space select, F2 rename, ←/→ move between tabs. */
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>, b: Board, index: number) => {
    const focusTab = (i: number) => {
      const tabs = e.currentTarget.parentElement?.querySelectorAll<HTMLElement>("[role=tab]");
      const next = tabs?.[(i + (tabs?.length ?? 1)) % (tabs?.length ?? 1)];
      next?.focus();
    };
    const actions: Record<string, () => void> = {
      " ": () => state.select(b.id),
      ArrowLeft: () => focusTab(index - 1),
      ArrowRight: () => focusTab(index + 1),
      Enter: () => state.select(b.id),
      F2: () => startRename(b),
    };
    const action = actions[e.key];
    if (action) {
      e.preventDefault();
      action();
    }
  };

  const create = () => void run(state.create(nextBoardName(state.boards)));

  return (
    <div className="flex h-8 items-end gap-0.5 overflow-x-auto px-1 pt-1" role="tablist">
      {state.boards.map((b, index) => {
        const active = b.id === state.active?.id;
        return (
          <div
            aria-controls="board-panel"
            aria-selected={active}
            className={cn(
              "group flex h-7 flex-none items-center gap-1 rounded-t-sm border border-b-0 px-2.5 outline-none select-none",
              "focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-ring",
              active ? "bg-background text-foreground" : "border-transparent text-muted-foreground hover:bg-accent",
            )}
            key={b.id}
            onClick={() => state.select(b.id)}
            onDoubleClick={() => startRename(b)}
            onKeyDown={(e) => onTabKey(e, b, index)}
            role="tab"
            tabIndex={active ? 0 : -1}
            title="Double-click or F2 to rename"
          >
            {editing === b.id ? (
              <Input
                aria-label="Board name"
                autoFocus
                className="h-5 w-36 px-1"
                onBlur={commitRename}
                onChange={(e) => setDraft(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={onRenameKey}
                value={draft}
              />
            ) : (
              <span className="max-w-48 truncate">{b.name}</span>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label={`Board options for ${b.name}`}
                  className={cn(
                    "rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground",
                    !active && "invisible group-focus-within:visible group-hover:visible",
                  )}
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              {/* Don't return focus to the trigger: it would blur the rename field at once. */}
              <DropdownMenuContent align="start" onCloseAutoFocus={(e) => e.preventDefault()}>
                <DropdownMenuItem onSelect={() => startRename(b)}>Rename</DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => setConfirmDelete(b)}
                >
                  Delete board…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      })}
      <Button
        aria-label="New board"
        className="mb-0.5 ml-1"
        onClick={create}
        size="icon-compact"
        title="New board"
        variant="ghost"
      >
        <Plus />
      </Button>
      {confirmDelete && (
        <ConfirmDialog
          confirmLabel="Delete board"
          description={`“${confirmDelete.name}” and the positions of its tracks will be deleted. Tracks and links stay.`}
          onCancel={() => setConfirmDelete(undefined)}
          onConfirm={() => {
            const id = confirmDelete.id;
            setConfirmDelete(undefined);
            void run(state.remove(id));
          }}
          title="Delete board?"
        />
      )}
    </div>
  );
}
