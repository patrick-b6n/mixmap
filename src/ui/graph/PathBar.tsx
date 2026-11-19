import { ArrowRight, Route, X } from "lucide-react";
import { Button } from "@/ui/components/ui/button";
import { cn } from "@/ui/lib/utils";
import type { TrackPath } from "@/business/paths";
import { m } from "@/paraglide/messages.js";

type Props = {
  from?: string;
  /** Track keys on the graph (others are marked "not on the graph"). */
  onGraph: Set<string>;
  label: (key: string) => string;
  onClear: () => void;
  onSelect: (index: number) => void;
  paths: TrackPath[];
  selected: number;
  to?: string;
};

/** Path-finding results: from → to, the shortest paths, the selected one highlighted on the graph. */
export function PathBar({ from, label, onGraph, onClear, onSelect, paths, selected, to }: Props) {
  const steps = paths[0] ? paths[0].keys.length - 1 : 0;
  return (
    <div
      className="flex flex-col gap-1 border-b bg-card px-2 py-1 text-[12px]"
      data-testid="path-bar"
    >
      <div className="flex items-center gap-1.5">
        <Route className="size-3.5 flex-none text-primary" />
        <span className="truncate">
          <span className="text-muted-foreground">{m.path_from()}</span>{" "}
          {from ? label(from) : m.path_pick()}
        </span>
        <ArrowRight className="size-3.5 flex-none text-muted-foreground" />
        <span className="truncate">
          <span className="text-muted-foreground">{m.path_to()}</span>{" "}
          {to ? label(to) : m.path_pick()}
        </span>
        <span className="flex-1" />
        {from && to && (
          <span className="flex-none text-muted-foreground" data-testid="path-summary">
            {paths.length === 0
              ? m.path_none()
              : paths.length > 1
                ? m.path_summary_ways({
                    steps: m.path_steps({ count: steps }),
                    ways: m.path_ways({ count: paths.length }),
                  })
                : m.path_steps({ count: steps })}
          </span>
        )}
        <Button aria-label={m.path_close()} onClick={onClear} size="icon-compact" variant="ghost">
          <X />
        </Button>
      </div>
      {paths.length > 0 && (
        <ol aria-label={m.path_list_label()} className="flex flex-col gap-0.5">
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
                      className={cn(!onGraph.has(k) && "text-muted-foreground italic")}
                      title={onGraph.has(k) ? undefined : m.path_not_on_graph()}
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
