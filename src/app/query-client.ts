import { QueryClient } from "@tanstack/react-query";

/**
 * Creates the TanStack Query client of a window.
 *
 * Data comes from the local SQLite database and the in-process Rust backend, so:
 * - `retry: false` – a failing query will fail again; surface the error at once.
 * - `refetchOnWindowFocus: false` – the backend announces changes as events.
 *
 * `staleTime` stays at the default (0): local queries are cheap. Mutations
 * invalidate the affected queries (src/ui/queries.ts).
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { refetchOnWindowFocus: false, retry: false },
    },
  });
}
