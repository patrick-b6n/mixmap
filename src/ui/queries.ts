// TanStack Query keys and hooks for the data the views share. Reads go through the
// services (src/app); writes call the services and invalidate what they changed.
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

/** Query keys, in one place. */
export const queryKeys = {
  /** The rekordbox library (tracks, playlists, histories). */
  library: ["library"] as const,
  libraryStatus: ["library-status"] as const,
  /** mixmap's links and stored tracks (per library version: matching updates tracks). */
  mixmap: ["mixmap"] as const,
  /** Cards on the graph. */
  nodes: ["nodes"] as const,
  /** Matching of mixmap tracks against the library. */
  reconcile: ["reconcile"] as const,
  syncStatus: ["sync-status"] as const,
  version: ["version"] as const,
  nowPlaying: ["now-playing"] as const,
  overlayHotkey: ["overlay-hotkey"] as const,
  updateCheck: ["update-check"] as const,
};

/** mixmap data changed: reload links, tracks and the graph. */
export function invalidateMixmap(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.mixmap }),
    queryClient.invalidateQueries({ queryKey: queryKeys.nodes }),
  ]).then(() => undefined);
}

/** A stable callback that reloads mixmap data after a change. */
export function useRefreshMixmap(): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => void invalidateMixmap(queryClient), [queryClient]);
}
