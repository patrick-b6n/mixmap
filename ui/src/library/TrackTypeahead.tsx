import { type KeyboardEvent, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Track } from "../api";
import { typeahead } from "../domain/nowPlaying";
import { formatBpm, keyLabel } from "../domain/trackTable";

/** Type-ahead: type to search; ↑/↓ + Enter or click to pick. */
export function TrackTypeahead({
  autoFocus,
  candidates,
  library,
  onPick,
  suggestions,
}: {
  autoFocus: boolean;
  candidates?: Track[];
  library: Track[];
  onPick: (trackId: string) => void;
  suggestions: Track[];
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const results = typeahead(library, query, candidates ?? suggestions);
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, results.length - 1));
    else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
    else if (e.key === "Enter" && results[active]) onPick(results[active].id);
    else return;
    e.preventDefault();
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 p-1.5">
      <Input
        aria-label="Set track"
        autoFocus={autoFocus}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        placeholder="Type to set the track…"
        value={query}
      />
      {!query.trim() && results.length > 0 && (
        <div className="px-1 text-[10px] text-muted-foreground uppercase">
          {candidates ? "Candidates" : "Linked from the other decks"}
        </div>
      )}
      <ul aria-label="Matching tracks" className="min-h-0 flex-1 overflow-y-auto" role="listbox">
        {results.map((t, i) => (
          <li aria-selected={i === active} key={t.id} role="option">
            <button
              className={cn(
                "w-full rounded-sm px-1.5 py-0.5 text-left",
                i === active ? "bg-accent" : "hover:bg-accent/50",
              )}
              onClick={() => onPick(t.id)}
              onMouseEnter={() => setActive(i)}
              type="button"
            >
              <div className="truncate">{t.title}</div>
              <div className="truncate text-[11px] text-muted-foreground">
                {t.artist}
                {t.bpm > 0 && ` · ${formatBpm(t.bpm)}`}
                {t.key && ` · ${keyLabel(t.key)}`}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
