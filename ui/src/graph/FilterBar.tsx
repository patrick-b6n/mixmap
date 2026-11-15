import { Eye, EyeOff, Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { type GraphFilter, isActive } from "../domain/filters";
import { parseKey } from "../domain/keys";

type Props = {
  filter: GraphFilter;
  hide: boolean;
  /** Matching / total nodes on the board, shown while a filter is active. */
  matched: number;
  onChange: (f: GraphFilter) => void;
  onHideChange: (hide: boolean) => void;
  total: number;
};

const num = (s: string): number | undefined => {
  const n = Number(s.replace(",", "."));
  return s.trim() === "" || !Number.isFinite(n) ? undefined : n;
};

/** Filter bar above the graph: non-matching nodes are dimmed, or hidden. Never filters the table. */
export function FilterBar({ filter, hide, matched, onChange, onHideChange, total }: Props) {
  const set = (patch: Partial<GraphFilter>) => onChange({ ...filter, ...patch });
  const active = isActive(filter);
  const badKey = filter.key !== undefined && filter.key.trim() !== "" && !parseKey(filter.key);
  const text = (field: "artist" | "comment" | "genre" | "name", placeholder: string, width: string) => (
    <Input
      aria-label={placeholder}
      className={width}
      onChange={(e) => set({ [field]: e.target.value })}
      placeholder={placeholder}
      value={filter[field] ?? ""}
    />
  );
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b bg-card px-2 py-1" role="search">
      <Filter className={cn("size-3.5 flex-none", active ? "text-primary" : "text-muted-foreground")} />
      {text("name", "Name", "w-32")}
      {text("artist", "Artist", "w-28")}
      {text("genre", "Genre", "w-24")}
      <Input
        aria-label="BPM from"
        className="w-14"
        inputMode="decimal"
        onChange={(e) => set({ bpmMin: num(e.target.value) })}
        placeholder="BPM"
        value={filter.bpmMin ?? ""}
      />
      <span className="text-muted-foreground">–</span>
      <Input
        aria-label="BPM to"
        className="w-14"
        inputMode="decimal"
        onChange={(e) => set({ bpmMax: num(e.target.value) })}
        placeholder="BPM"
        value={filter.bpmMax ?? ""}
      />
      <Input
        aria-invalid={badKey || undefined}
        aria-label="Key"
        className="w-14"
        onChange={(e) => set({ key: e.target.value })}
        placeholder="Key"
        title="Camelot (8A), Open Key (1m) or musical (Am)"
        value={filter.key ?? ""}
      />
      <select
        aria-label="Minimum rating"
        className="h-6 rounded-sm border border-input bg-input/30 px-1 text-[13px]"
        onChange={(e) => set({ minRating: Number(e.target.value) || undefined })}
        value={filter.minRating ?? 0}
      >
        <option value={0}>Any rating</option>
        {[1, 2, 3, 4, 5].map((r) => (
          <option key={r} value={r}>
            {"★".repeat(r)}
            {r < 5 ? "+" : ""}
          </option>
        ))}
      </select>
      {text("comment", "Comment", "w-28")}
      <Button
        aria-pressed={hide}
        onClick={() => onHideChange(!hide)}
        title={hide ? "Non-matching tracks are hidden" : "Non-matching tracks are dimmed"}
        variant={hide ? "default" : "subtle"}
      >
        {hide ? <EyeOff /> : <Eye />}
        {hide ? "Hide" : "Dim"}
      </Button>
      {active && (
        <>
          <span className="text-muted-foreground tabular-nums" data-testid="filter-count">
            {matched} of {total}
          </span>
          <Button aria-label="Clear filters" onClick={() => onChange({})} size="icon-compact" variant="ghost">
            <X />
          </Button>
        </>
      )}
    </div>
  );
}
