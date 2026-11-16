import { useCallback, useEffect, useState } from "react";
import type { Library } from "@/business/model";
import { useAppServices } from "@/app/app-services";
import type { MatchResult } from "@/business/matching";

/** Reconcile runs are chained so their database writes never interleave. */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Match mixmap tracks against every new library version (after mixmap.db is ready)
 * and keep the results: missing tracks get flagged in the database, unmatched and
 * ambiguous ones are listed for manual mapping.
 */
export function useReconcile(library: Library | undefined): {
  error?: string;
  /** Match again (e.g. after a manual mapping). */
  rerun: () => void;
  results: MatchResult[];
} {
  const { tracks } = useAppServices();
  const [results, setResults] = useState<MatchResult[]>([]);
  const [error, setError] = useState<string>();
  const [tick, setTick] = useState(0);
  const rerun = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    // An empty library (failed or not yet loaded) would mark every track missing.
    if (!library || library.tracks.length === 0) return;
    let live = true;
    const run = queue.then(() => tracks.reconcile(library.tracks));
    queue = run.catch(() => undefined);
    run.then(
      (r) => {
        if (!live) return;
        setResults(r);
        setError(undefined);
      },
      (e) => {
        if (!live) return;
        setResults([]);
        setError(`matching: ${String(e)}`);
      },
    );
    return () => {
      live = false;
    };
    // tick is a trigger: re-run after a manual mapping.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [library, tick, tracks]);

  return { error, rerun, results };
}
