import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  clampShare,
  DEFAULT_LAYOUT,
  loadLayout,
  type LayoutState,
  saveLayout,
  shareFromPointer,
} from "./layoutState";
import "./shell.css";

type Props = {
  details: ReactNode;
  filterBar?: ReactNode;
  graph: ReactNode;
  playlists: ReactNode;
  table: ReactNode;
  toolbar?: ReactNode;
};

const KEY_STEP = 0.02;

/**
 * Main window: collapsible playlist tree | graph (top) + table (bottom) with a
 * draggable, remembered splitter | collapsible details panel.
 */
export function Shell({ details, filterBar, graph, playlists, table, toolbar }: Props) {
  const [layout, setLayout] = useState<LayoutState>(loadLayout);
  const [dragging, setDragging] = useState(false);
  const centerRef = useRef<HTMLDivElement>(null);
  /** Pointer offset within the splitter at grab time, so it doesn't jump. */
  const grabOffset = useRef(0);

  // Persist when not mid-drag (one write per drag instead of one per move).
  useEffect(() => {
    if (!dragging) saveLayout(layout);
  }, [dragging, layout]);

  const update = useCallback((patch: Partial<LayoutState>) => setLayout((l) => ({ ...l, ...patch })), []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    grabOffset.current = e.clientY - e.currentTarget.getBoundingClientRect().top;
    setDragging(true);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const center = centerRef.current;
    if (!dragging || !center) return;
    const rect = center.getBoundingClientRect();
    update({ graphShare: shareFromPointer(e.clientY - grabOffset.current, rect.top, rect.height) });
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next: Record<string, (share: number) => number> = {
      ArrowDown: (s) => s + KEY_STEP,
      ArrowUp: (s) => s - KEY_STEP,
      End: () => 1,
      Enter: () => DEFAULT_LAYOUT.graphShare,
      Home: () => 0,
    };
    const step = next[e.key];
    if (step) {
      e.preventDefault();
      setLayout((l) => ({ ...l, graphShare: clampShare(step(l.graphShare)) }));
    }
  };

  return (
    <div className="shell">
      <header className="shell-toolbar">
        <button
          aria-label={layout.leftCollapsed ? "Show playlists" : "Hide playlists"}
          className="icon-button"
          onClick={() => update({ leftCollapsed: !layout.leftCollapsed })}
          title="Toggle playlists"
        >
          ☰
        </button>
        <span className="shell-title">MixMap</span>
        <div className="shell-toolbar-content">{toolbar}</div>
        <button
          aria-label={layout.rightCollapsed ? "Show details" : "Hide details"}
          className="icon-button"
          onClick={() => update({ rightCollapsed: !layout.rightCollapsed })}
          title="Toggle details"
        >
          ⓘ
        </button>
      </header>
      <div className="shell-body">
        {!layout.leftCollapsed && <aside className="shell-left">{playlists}</aside>}
        <div className="shell-center" ref={centerRef}>
          <section className="shell-graph" style={{ flexGrow: layout.graphShare }}>
            {filterBar && <div className="shell-filterbar">{filterBar}</div>}
            <div className="shell-graph-canvas">{graph}</div>
          </section>
          <div
            aria-label="Resize graph and table"
            aria-orientation="horizontal"
            aria-valuemax={85}
            aria-valuemin={15}
            aria-valuenow={Math.round(layout.graphShare * 100)}
            className={`shell-splitter${dragging ? " dragging" : ""}`}
            onDoubleClick={() => update({ graphShare: DEFAULT_LAYOUT.graphShare })}
            onKeyDown={onKeyDown}
            onLostPointerCapture={() => setDragging(false)}
            onPointerCancel={endDrag}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            role="separator"
            tabIndex={0}
          />
          <section className="shell-table" style={{ flexGrow: 1 - layout.graphShare }}>
            {table}
          </section>
        </div>
        {!layout.rightCollapsed && <aside className="shell-right">{details}</aside>}
      </div>
    </div>
  );
}
