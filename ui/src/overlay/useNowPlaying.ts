import { useCallback, useEffect, useState } from "react";
import { subscribe } from "../api";
import type { ManualState, NowPlayingUpdate } from "../domain/nowPlaying";

const MANUAL_KEY = "mixmap.overlay.manual";

function loadManual(): ManualState {
  try {
    const raw = localStorage.getItem(MANUAL_KEY);
    const v: unknown = raw ? JSON.parse(raw) : undefined;
    if (v && typeof v === "object" && "decks" in v && typeof v.decks === "object" && v.decks) {
      return v as ManualState;
    }
  } catch {
    // fall through
  }
  return { decks: {} };
}

function saveManual(m: ManualState): void {
  try {
    localStorage.setItem(MANUAL_KEY, JSON.stringify(m));
  } catch {
    // not remembered
  }
}

/**
 * The automatic source's last update (backend event `now-playing`) and manual mode's
 * settings (remembered on this machine, shared between windows of this app).
 */
export function useNowPlaying(): {
  auto?: NowPlayingUpdate;
  manual: ManualState;
  setManual: (m: ManualState) => void;
} {
  const [auto, setAuto] = useState<NowPlayingUpdate>();
  const [manual, setManualState] = useState<ManualState>(loadManual);

  useEffect(() => subscribe("now-playing", (u) => setAuto(u as NowPlayingUpdate)), []);

  // Another window changed manual mode.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => e.key === MANUAL_KEY && setManualState(loadManual());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setManual = useCallback((m: ManualState) => {
    setManualState(m);
    saveManual(m);
  }, []);

  return { auto, manual, setManual };
}
