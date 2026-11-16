import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { useAppServices } from "@/app/app-services";
import { subscribe } from "@/app/events";
import type { Library, LibraryStatus } from "@/business/model";

import { queryKeys } from "../queries";

export type LibraryState = {
  error?: string;
  library?: Library;
  refresh: () => void;
  status?: LibraryStatus;
};

/** The rekordbox library, refetched whenever the backend reports a new version. */
export function useLibrary(): LibraryState {
  const { backend } = useAppServices();
  const queryClient = useQueryClient();
  const [refreshError, setRefreshError] = useState<string>();
  const status = useQuery({ queryKey: queryKeys.libraryStatus, queryFn: backend.libraryStatus });
  const library = useQuery({ queryKey: queryKeys.library, queryFn: backend.library });

  // The backend announces every (re)load: refetch the library when its version changed.
  useEffect(
    () =>
      subscribe("library", (payload) => {
        const next = payload as LibraryStatus;
        queryClient.setQueryData(queryKeys.libraryStatus, next);
        const shown = queryClient.getQueryData<Library>(queryKeys.library);
        if (shown?.version !== next.version) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.library });
        }
      }),
    [queryClient],
  );

  const refresh = useCallback(() => {
    setRefreshError(undefined);
    // The backend announces the reload as a "library" event, which refetches.
    backend.refresh().then(
      (s) => queryClient.setQueryData(queryKeys.libraryStatus, s),
      (e: unknown) => setRefreshError(String(e)),
    );
  }, [backend, queryClient]);

  const error = refreshError ?? library.error ?? status.error;
  return {
    error: error ? String(error) : undefined,
    library: library.data,
    refresh,
    status: status.data,
  };
}
