import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { useAppServices } from "@/app/app-services";
import { m } from "@/paraglide/messages.js";
import { errorMessage } from "@/ui/errors";
import type { MatchResult } from "@/business/matching";
import type { Library } from "@/business/model";

import { invalidateMixmap, queryKeys } from "../queries";

/** Reconcile runs are chained so their database writes never interleave. */
let queue: Promise<unknown> = Promise.resolve();

const NO_RESULTS: MatchResult[] = [];

/**
 * Match mixmap tracks against every new library version and keep the results:
 * missing tracks get flagged in the database, unmatched and ambiguous ones are
 * listed for manual mapping.
 */
export function useReconcile(library: Library | undefined): {
  error?: string;
  /** Match again (e.g. after a manual mapping). */
  rerun: () => void;
  results: MatchResult[];
} {
  const { tracks } = useAppServices();
  const queryClient = useQueryClient();
  const { data, error } = useQuery({
    queryKey: [...queryKeys.reconcile, library?.version],
    queryFn: async () => {
      const run = queue.then(() => tracks.reconcile(library?.tracks ?? []));
      queue = run.catch(() => undefined);
      const results = await run;
      // Flags and rekordbox ids may have changed.
      void invalidateMixmap(queryClient);
      return results;
    },
    // An empty library (failed or not yet loaded) would mark every track missing.
    enabled: (library?.tracks.length ?? 0) > 0,
  });
  const rerun = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: queryKeys.reconcile }),
    [queryClient],
  );
  return {
    error: error ? m.matching_failed({ error: errorMessage(error) }) : undefined,
    rerun,
    results: data ?? NO_RESULTS,
  };
}
