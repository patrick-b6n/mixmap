import {
  type KeyboardEvent,
  type PointerEvent,
  type UIEvent,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { Button } from "@/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/ui/components/ui/dropdown-menu";
import { Input } from "@/ui/components/ui/input";
import { Placeholder } from "@/ui/components/Placeholder";
import { cn } from "@/ui/lib/utils";
import type { Track } from "@/business/model";
import { TRACK_MIME } from "@/ui/graph/dnd";
import { TrackCard } from "@/ui/graph/TrackCard";
import { Artwork } from "./Artwork";
import {
  COLUMNS,
  type ColumnId,
  type ColumnState,
  formatBpm,
  formatLength,
  keyLabel,
  MIN_COLUMN_WIDTH,
  nextSort,
  parseConfig,
  searchTracks,
  sortTracks,
  stars,
  type TableConfig,
} from "@/business/trackTable";

const ROW_HEIGHT = 28;
const HEADER_HEIGHT = 26;
const OVERSCAN = 8;
const STORAGE_KEY = "mixmap.table";

type Props = {
  linkCount?: (trackId: string) => number;
  /** Double-click / Ctrl+L: show this track in the graph. */
  onLocate?: (trackId: string) => void;
  onSelect: (trackId: string) => void;
  selectedId?: string;
  tracks: Track[];
  version: number;
};

function loadConfig(): TableConfig {
  try {
    return parseConfig(localStorage.getItem(STORAGE_KEY));
  } catch {
    return parseConfig(null);
  }
}

const LABELS = new Map(COLUMNS.map((c) => [c.id, c]));
const NO_LINKS = () => 0;

/** Virtualized track table with search, sorting, column choice and resizing. */
export function TrackTable({
  linkCount = NO_LINKS,
  onLocate,
  onSelect,
  selectedId,
  tracks,
  version,
}: Props) {
  const [config, setConfig] = useState<TableConfig>(loadConfig);
  const [query, setQuery] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(400);
  const bodyRef = useRef<HTMLDivElement>(null);
  /** Row being dragged: drawn off-screen as a graph card for the drag image. */
  const [dragged, setDragged] = useState<Track>();
  const ghostRef = useRef<HTMLDivElement>(null);

  // Save a moment after the last change (column resizing changes config per move).
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
      } catch {
        // not remembered
      }
    }, 300);
    return () => clearTimeout(t);
  }, [config]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const deferredQuery = useDeferredValue(query);
  const rows = useMemo(
    () => sortTracks(searchTracks(tracks, deferredQuery), config.sort, linkCount),
    [tracks, deferredQuery, config.sort, linkCount],
  );

  // A different list starts at the top (onScroll then updates scrollTop). The
  // dependencies are the triggers, not values used inside. Block body: scrollTo()
  // returns a Promise in newer browsers, which an effect must not return.
  useEffect(() => {
    bodyRef.current?.scrollTo(0, 0);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [tracks, deferredQuery, config.sort]);

  /** Arrow keys move the selection; the selected row is scrolled into view. */
  // A selection made elsewhere (e.g. a graph click) scrolls its row into view.
  useEffect(() => {
    const body = bodyRef.current;
    const i = rows.findIndex((t) => t.id === selectedId);
    if (!body || i < 0) return;
    // Rows start below the sticky header.
    const top = i * ROW_HEIGHT;
    const visibleTop = body.scrollTop;
    const visibleBottom = body.scrollTop + body.clientHeight - HEADER_HEIGHT - ROW_HEIGHT / 2;
    if (top < visibleTop || top + ROW_HEIGHT > visibleBottom) {
      body.scrollTop = Math.max(0, top - (body.clientHeight - HEADER_HEIGHT) / 2);
    }
    // Only when the selection changes, not on every re-sort.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const onGridKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    e.preventDefault();
    const i = rows.findIndex((t) => t.id === selectedId);
    const next = Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
    const t = rows[next];
    if (!t) return;
    onSelect(t.id);
    const body = bodyRef.current;
    if (!body) return;
    const top = next * ROW_HEIGHT;
    if (top < body.scrollTop) body.scrollTop = top;
    else if (top + ROW_HEIGHT > body.scrollTop + body.clientHeight - HEADER_HEIGHT)
      body.scrollTop = top + ROW_HEIGHT - body.clientHeight + HEADER_HEIGHT;
  };
  const visibleColumns = config.columns.filter((c) => c.visible);
  const totalWidth = visibleColumns.reduce((w, c) => w + c.width, 0);

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + viewHeight) / ROW_HEIGHT) + OVERSCAN);

  const setColumn = (id: ColumnId, patch: Partial<ColumnState>) =>
    setConfig((c) => ({
      ...c,
      columns: c.columns.map((col) => (col.id === id ? { ...col, ...patch } : col)),
    }));

  const startResize = (e: PointerEvent<HTMLDivElement>, col: ColumnState) => {
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const move = (ev: globalThis.PointerEvent) =>
      setColumn(col.id, { width: Math.max(MIN_COLUMN_WIDTH, col.width + ev.clientX - startX) });
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  const cell = (t: Track, id: ColumnId) => {
    switch (id) {
      case "artwork":
        return <Artwork trackId={t.id} version={version} />;
      case "bpm":
        return formatBpm(t.bpm);
      case "key":
        return keyLabel(t.key);
      case "length":
        return formatLength(t.length);
      case "links":
        return linkCount(t.id) || "";
      case "rating":
        return stars(t.rating);
      default:
        return t[id];
    }
  };

  /** Columns in chooser order: everything but artwork, then artwork last. */
  const chooserColumns = [
    ...config.columns.filter((c) => c.id !== "artwork"),
    ...config.columns.filter((c) => c.id === "artwork"),
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-2 py-1">
        <Input
          aria-label="Search tracks"
          className="max-w-105 flex-1"
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title, artist, album, genre, key, comment…"
          type="search"
          value={query}
        />
        <span className="flex-1 text-muted-foreground">
          {rows.length === tracks.length
            ? `${rows.length} tracks`
            : `${rows.length} of ${tracks.length}`}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button title="Choose columns">Columns</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {chooserColumns.map((c) => (
              <DropdownMenuCheckboxItem
                checked={c.visible}
                key={c.id}
                onCheckedChange={(checked) => setColumn(c.id, { visible: checked === true })}
                // Keep the menu open while toggling several columns.
                onSelect={(e) => e.preventDefault()}
              >
                {c.id === "artwork" ? "Artwork" : LABELS.get(c.id)?.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div
        aria-label="Tracks"
        aria-rowcount={rows.length + 1}
        className="relative min-h-0 flex-1 scroll-pt-6.5 overflow-auto outline-none focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-ring"
        onKeyDown={onGridKeyDown}
        onScroll={(e: UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop)}
        ref={bodyRef}
        role="grid"
        tabIndex={0}
      >
        <div
          className="sticky top-0 z-10 flex h-6.5 border-b bg-card"
          role="row"
          style={{ width: totalWidth }}
        >
          {visibleColumns.map((c) => {
            const def = LABELS.get(c.id)!;
            const sorted = config.sort?.column === c.id ? (config.sort.desc ? " ▼" : " ▲") : "";
            return (
              <div
                aria-sort={sorted ? (config.sort?.desc ? "descending" : "ascending") : undefined}
                className={cn(
                  "relative flex flex-none items-center px-1.5 text-muted-foreground outline-none select-none",
                  "focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-ring",
                  def.sortable && "cursor-pointer",
                )}
                key={c.id}
                onClick={() =>
                  def.sortable && setConfig((cfg) => ({ ...cfg, sort: nextSort(cfg.sort, c.id) }))
                }
                onKeyDown={(e) => {
                  if (def.sortable && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    setConfig((cfg) => ({ ...cfg, sort: nextSort(cfg.sort, c.id) }));
                  }
                }}
                role="columnheader"
                style={{ width: c.width }}
                tabIndex={def.sortable ? 0 : undefined}
              >
                <span className="truncate">
                  {def.label}
                  {sorted}
                </span>
                <div
                  className="absolute inset-y-0 -right-0.75 z-10 w-1.5 cursor-col-resize hover:bg-primary"
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => startResize(e, c)}
                />
              </div>
            );
          })}
        </div>
        <div className="relative" style={{ height: rows.length * ROW_HEIGHT, width: totalWidth }}>
          {rows.slice(first, last).map((t, i) => {
            const selected = t.id === selectedId;
            return (
              <div
                aria-rowindex={first + i + 2}
                aria-selected={selected}
                className={cn(
                  "absolute inset-x-0 flex items-center hover:bg-accent",
                  (first + i) % 2 === 1 && "bg-stripe",
                  selected && "bg-selected hover:bg-selected",
                )}
                // Position-based: a playlist may contain the same track twice.
                draggable
                key={first + i}
                onClick={() => onSelect(t.id)}
                onDoubleClick={() => onLocate?.(t.id)}
                onDragEnd={() => setDragged(undefined)}
                onDragStart={(e) => {
                  e.dataTransfer.setData(TRACK_MIME, t.id);
                  e.dataTransfer.effectAllowed = "copyLink";
                  // Show the track as it will look on the graph, not as a table row.
                  flushSync(() => setDragged(t));
                  if (ghostRef.current) e.dataTransfer.setDragImage(ghostRef.current, 16, 16);
                }}
                role="row"
                style={{ height: ROW_HEIGHT, top: (first + i) * ROW_HEIGHT }}
              >
                {visibleColumns.map((c) => (
                  <div
                    className={cn(
                      "flex-none truncate px-1.5",
                      (c.id === "bpm" || c.id === "length" || c.id === "links") &&
                        "text-right tabular-nums",
                      c.id === "rating" && "text-rating",
                      c.id === "artwork" && "px-1",
                    )}
                    key={c.id}
                    role="gridcell"
                    style={{ width: c.width }}
                  >
                    {cell(t, c.id)}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        {rows.length === 0 && (
          <Placeholder>{tracks.length ? "No matches" : "No tracks"}</Placeholder>
        )}
      </div>
      {/* Drag image source: rendered off-screen while a row is dragged. */}
      <div aria-hidden className="pointer-events-none fixed top-0 -left-[1000px]" ref={ghostRef}>
        {dragged && (
          <TrackCard
            artworkVersion={version}
            card={{
              artist: dragged.artist,
              linkCount: linkCount(dragged.id),
              missing: false,
              title: dragged.title,
              track: dragged,
            }}
            eager
          />
        )}
      </div>
    </div>
  );
}
