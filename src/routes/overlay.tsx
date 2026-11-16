import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

import { inTauri } from "@/app/backend";
import { Overlay } from "@/ui/overlay/Overlay";
import { m } from "@/paraglide/messages.js";

/** The live overlay (its own always-on-top window in the desktop app). */
export const Route = createFileRoute("/overlay")({
  component: OverlayWindow,
  head: () => ({ meta: [{ title: m.overlay_window_title() }] }),
});

function OverlayWindow() {
  // The desktop overlay window is transparent: only the panel itself is drawn.
  useEffect(() => {
    if (!inTauri()) return;
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  }, []);
  return <Overlay />;
}
