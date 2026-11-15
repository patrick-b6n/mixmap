import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
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

  // Focus the first item; give focus back to where it was when the menu closes.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => previous?.focus?.();
  }, []);

  /** ↑/↓ move between items (wrapping), Home/End jump. */
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
    const i = buttons.indexOf(document.activeElement as HTMLElement);
    const go: Record<string, number> = { ArrowDown: i + 1, ArrowUp: i - 1, End: buttons.length - 1, Home: 0 };
    if (e.key in go) {
      e.preventDefault();
      buttons[(go[e.key] + buttons.length) % buttons.length]?.focus();
    }
  };

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
      onKeyDown={onKeyDown}
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
