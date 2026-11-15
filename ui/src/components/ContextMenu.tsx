import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type ContextMenuItem = { destructive?: boolean; label: string; onSelect: () => void };

type Props = { items: ContextMenuItem[]; onClose: () => void; x: number; y: number };

/** Small menu at a screen position (right-click). Closes on outside click or Escape. */
export function ContextMenu({ items, onClose, x, y }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Keep the menu inside the window (right-click near an edge).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
      y: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)),
    });
  }, [x, y]);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, []);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      className="fixed z-50 min-w-40 rounded-md border bg-popover p-1 text-[13px] shadow-md"
      ref={ref}
      role="menu"
      style={{ left: pos.x, top: pos.y }}
    >
      {items.map((item) => (
        <button
          className={cn(
            "flex w-full rounded-sm px-2 py-1 text-left outline-none hover:bg-accent focus-visible:bg-accent",
            item.destructive && "text-destructive",
          )}
          key={item.label}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
          role="menuitem"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
