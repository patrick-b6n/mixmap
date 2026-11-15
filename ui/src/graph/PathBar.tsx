import { ArrowRight, Route, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TrackPath } from "../domain/paths";

type Props = {
  from?: string;
  /** Track keys on the active board (others are marked "not on this board"). */
  onBoard: Set<string>;
  label: (key: string) => string;
  onClear: () => void;
  onSelect: (index: number) => void;
  paths: TrackPath[];
  selected: number;
  to?: string;
};

/** Path-finding results: from → to, the shortest paths, the selected one highlighted on the board. */
export function PathBar({ from, label, onBoard, onClear, onSelect, paths, selected, to }: Props) {
  const steps = paths[0] ? paths[0].keys.length - 1 : 0;
  return (
    <div className="flex flex-col gap-1 border-b bg-card px-2 py-1 text-[12px]" data-testid="path-bar">
      <div className="flex items-center gap-1.5">
        <Route className="size-3.5 flex-none text-primary" />
        <span className="truncate">
          <span className="text-muted-foreground">From</span> {from ? label(from) : "— right-click a track"}
        </span>
        <ArrowRight className="size-3.5 flex-none text-muted-foreground" />
        <span className="truncate">
          <span className="text-muted-foreground">to</span> {to ? label(to) : "— right-click a track"}
        </span>
        <span className="flex-1" />
        {from && to && (
          <span className="flex-none text-muted-foreground" data-testid="path-summary">
            {paths.length === 0
              ? "no path"
              : `${steps} step${steps === 1 ? "" : "s"}${paths.length > 1 ? ` · ${paths.length} ways` : ""}`}
          </span>
        )}
        <Button aria-label="Close path" onClick={onClear} size="icon-compact" variant="ghost">
          <X />
        </Button>
      </div>
      {paths.length > 0 && (
        <ol aria-label="Paths" className="flex flex-col gap-0.5">
          {paths.map((p, i) => (
            <li key={p.keys.join("\u0001")}>
              <button
                aria-pressed={i === selected}
                className={cn(
                  "flex w-full flex-wrap items-center gap-1 rounded-sm px-1 text-left",
                  i === selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                )}
                onClick={() => onSelect(i)}
                type="button"
              >
                {p.keys.map((k, j) => (
                  <span className="flex items-center gap-1" key={k}>
                    {j > 0 && <ArrowRight className="size-3 text-muted-foreground" />}
                    <span
                      className={cn(!onBoard.has(k) && "text-muted-foreground italic")}
                      title={onBoard.has(k) ? undefined : "Not on this board"}
                    >
                      {label(k)}
                    </span>
                  </span>
                ))}
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
