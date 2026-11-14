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
import { artworkUrl, type Track } from "../api";
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
} from "../domain/trackTable";
import "./library.css";

const ROW_HEIGHT = 28;
const HEADER_HEIGHT = 26;
const OVERSCAN = 8;
const STORAGE_KEY = "mixmap.table";

type Props = {
  linkCount?: (trackId: string) => number;
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
export function TrackTable({ linkCount = NO_LINKS, onSelect, selectedId, tracks, version }: Props) {
  const [config, setConfig] = useState<TableConfig>(loadConfig);
  const [query, setQuery] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(400);
  const [chooserOpen, setChooserOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

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
  // dependencies are the triggers, not values used inside.
  // oxlint-disable-next-line react/exhaustive-effect-dependencies
  useEffect(() => bodyRef.current?.scrollTo(0, 0), [tracks, deferredQuery, config.sort]);

  /** Arrow keys move the selection; the selected row is scrolled into view. */
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
    setConfig((c) => ({ ...c, columns: c.columns.map((col) => (col.id === id ? { ...col, ...patch } : col)) }));

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

  return (
    <div className="table">
      <div className="table-toolbar">
        <input
          aria-label="Search tracks"
          className="table-search"
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title, artist, album, genre, key, comment…"
          type="search"
          value={query}
        />
        <span className="table-count">
          {rows.length === tracks.length ? `${rows.length} tracks` : `${rows.length} of ${tracks.length}`}
        </span>
        <div className="table-chooser">
          <button
            aria-expanded={chooserOpen}
            onClick={() => setChooserOpen((o) => !o)}
            onKeyDown={(e) => e.key === "Escape" && setChooserOpen(false)}
            title="Choose columns"
          >
            Columns
          </button>
          {chooserOpen && (
            <div
              className="table-chooser-menu"
              onKeyDown={(e) => e.key === "Escape" && setChooserOpen(false)}
              onMouseLeave={() => setChooserOpen(false)}
            >
              {config.columns
                .filter((c) => c.id !== "artwork")
                .map((c) => (
                  <label key={c.id}>
                    <input
                      checked={c.visible}
                      onChange={(e) => setColumn(c.id, { visible: e.target.checked })}
                      type="checkbox"
                    />
                    {LABELS.get(c.id)?.label}
                  </label>
                ))}
              <label>
                <input
                  checked={config.columns.find((c) => c.id === "artwork")?.visible ?? false}
                  onChange={(e) => setColumn("artwork", { visible: e.target.checked })}
                  type="checkbox"
                />
                Artwork
              </label>
            </div>
          )}
        </div>
      </div>
      <div
        aria-label="Tracks"
        aria-rowcount={rows.length + 1}
        className="table-body"
        onKeyDown={onGridKeyDown}
        onScroll={(e: UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop)}
        ref={bodyRef}
        role="grid"
        tabIndex={0}
      >
        <div className="table-header" role="row" style={{ width: totalWidth }}>
          {visibleColumns.map((c) => {
            const def = LABELS.get(c.id)!;
            const sorted = config.sort?.column === c.id ? (config.sort.desc ? " ▼" : " ▲") : "";
            return (
              <div
                aria-sort={sorted ? (config.sort?.desc ? "descending" : "ascending") : undefined}
                className={`th${def.sortable ? " sortable" : ""}`}
                key={c.id}
                onClick={() => def.sortable && setConfig((cfg) => ({ ...cfg, sort: nextSort(cfg.sort, c.id) }))}
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
                <span className="th-label">
                  {def.label}
                  {sorted}
                </span>
                <div
                  className="th-resize"
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => startResize(e, c)}
                />
              </div>
            );
          })}
        </div>
        <div style={{ height: rows.length * ROW_HEIGHT, position: "relative", width: totalWidth }}>
          {rows.slice(first, last).map((t, i) => (
            <div
              aria-rowindex={first + i + 2}
              aria-selected={t.id === selectedId}
              className={`tr ${(first + i) % 2 ? "odd" : "even"}${t.id === selectedId ? " selected" : ""}`}
              // Position-based: a playlist may contain the same track twice.
              key={first + i}
              onClick={() => onSelect(t.id)}
              role="row"
              style={{ height: ROW_HEIGHT, top: (first + i) * ROW_HEIGHT }}
            >
              {visibleColumns.map((c) => (
                <div className={`td td-${c.id}`} key={c.id} role="gridcell" style={{ width: c.width }}>
                  {cell(t, c.id)}
                </div>
              ))}
            </div>
          ))}
        </div>
        {rows.length === 0 && <div className="placeholder">{tracks.length ? "No matches" : "No tracks"}</div>}
      </div>
    </div>
  );
}

/** Artwork URLs known to have no image, so remounted rows don't ask again. */
const missingArtwork = new Set<string>();

/** Thumbnail with a placeholder when the track has no artwork. */
export function Artwork({
  size = "small",
  trackId,
  version,
}: {
  size?: "large" | "small";
  trackId: string;
  version: number;
}) {
  const url = artworkUrl(trackId, size, version);
  const [failedUrl, setFailedUrl] = useState<string>();
  const missing = failedUrl === url || missingArtwork.has(url);
  if (missing) return <div className={`artwork artwork-${size} artwork-placeholder`}>♪</div>;
  return (
    <img
      alt=""
      className={`artwork artwork-${size}`}
      loading="lazy"
      onError={() => {
        missingArtwork.add(url);
        setFailedUrl(url);
      }}
      src={url}
    />
  );
}
