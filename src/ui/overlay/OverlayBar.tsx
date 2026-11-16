import { AppWindow, MousePointerClick, X } from "lucide-react";
import { Button } from "@/ui/components/ui/button";
import { hideOverlay, saveOpacity, setClickThrough, showMain } from "@/app/overlay-window";

type Props = { onOpacity: (v: number) => void; opacity: number };

/**
 * Title bar of the frameless overlay window: drag it to move; opacity, click-through,
 * main window, hide. (Desktop app only.)
 */
export function OverlayBar({ onOpacity, opacity }: Props) {
  return (
    <div
      className="flex h-6 flex-none cursor-grab items-center gap-1.5 bg-card/80 px-2 text-[11px] text-muted-foreground select-none"
      data-tauri-drag-region
    >
      <span className="font-semibold" data-tauri-drag-region>
        mixmap
      </span>
      <span className="flex-1" data-tauri-drag-region />
      <input
        aria-label="Opacity"
        className="w-20 accent-primary"
        max={1}
        min={0.3}
        onChange={(e) => {
          const v = Number(e.target.value);
          onOpacity(v);
          saveOpacity(v);
        }}
        step={0.05}
        title="Opacity"
        type="range"
        value={opacity}
      />
      <Button
        aria-label="Click-through"
        onClick={() => void setClickThrough(true)}
        size="icon-compact"
        title="Click-through: clicks go to the window below (turn off in the main window's Overlay menu or with the hotkey)"
        variant="ghost"
      >
        <MousePointerClick className="size-3.5" />
      </Button>
      <Button
        aria-label="Open mixmap"
        onClick={() => void showMain()}
        size="icon-compact"
        title="Open mixmap"
        variant="ghost"
      >
        <AppWindow className="size-3.5" />
      </Button>
      <Button
        aria-label="Hide overlay"
        onClick={() => void hideOverlay()}
        size="icon-compact"
        title="Hide overlay"
        variant="ghost"
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
