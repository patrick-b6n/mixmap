import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { useAppServices } from "@/app/app-services";
import { queryKeys } from "../queries";
import { subscribe } from "@/app/events";
import type { ManualState, NowPlayingUpdate } from "@/business/nowPlaying";

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
  const { backend } = useAppServices();
  const queryClient = useQueryClient();
  const { data: auto } = useQuery({
    queryKey: queryKeys.nowPlaying,
    queryFn: async () => ((await backend.nowPlaying()) ?? null) as NowPlayingUpdate | null,
  });
  const [manual, setManualState] = useState<ManualState>(loadManual);

  useEffect(
    () =>
      subscribe("now-playing", (u) =>
        queryClient.setQueryData(queryKeys.nowPlaying, u as NowPlayingUpdate),
      ),
    [queryClient],
  );

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

  return { auto: auto ?? undefined, manual, setManual };
}
