import { type KeyboardEvent, type PointerEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { clampShare, DEFAULT_LAYOUT, loadLayout, type LayoutState, saveLayout, shareFromPointer } from "./layoutState";
import { PanelLeft, PanelRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
    <div className="flex h-full flex-col">
      <header className="flex h-9 items-center gap-2 border-b bg-card px-2">
        <Button
          aria-label={layout.leftCollapsed ? "Show playlists" : "Hide playlists"}
          onClick={() => update({ leftCollapsed: !layout.leftCollapsed })}
          size="icon-compact"
          title="Toggle playlists"
          variant="ghost"
        >
          <PanelLeft />
        </Button>
        <span className="font-semibold">MixMap</span>
        <div className="flex min-w-0 flex-1 items-center gap-2">{toolbar}</div>
        <Button
          aria-label={layout.rightCollapsed ? "Show details" : "Hide details"}
          onClick={() => update({ rightCollapsed: !layout.rightCollapsed })}
          size="icon-compact"
          title="Toggle details"
          variant="ghost"
        >
          <PanelRight />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1">
        {!layout.leftCollapsed && <aside className="w-60 flex-none overflow-auto border-r bg-card">{playlists}</aside>}
        <div className="flex min-w-80 flex-1 flex-col" ref={centerRef}>
          {/* Graph and table split the height by flex-grow ratios. */}
          <section className="flex min-h-20 basis-0 flex-col overflow-hidden" style={{ flexGrow: layout.graphShare }}>
            {filterBar && <div className="border-b">{filterBar}</div>}
            <div className="relative min-h-0 flex-1">{graph}</div>
          </section>
          <div
            aria-label="Resize graph and table"
            aria-orientation="horizontal"
            aria-valuemax={85}
            aria-valuemin={15}
            aria-valuenow={Math.round(layout.graphShare * 100)}
            className={cn(
              "h-1 flex-none cursor-row-resize bg-border outline-none hover:bg-primary focus-visible:bg-primary",
              dragging && "bg-primary",
            )}
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
          <section className="min-h-20 basis-0 overflow-hidden" style={{ flexGrow: 1 - layout.graphShare }}>
            {table}
          </section>
        </div>
        {!layout.rightCollapsed && <aside className="w-75 flex-none overflow-auto border-l bg-card">{details}</aside>}
      </div>
    </div>
  );
}
