import { useCallback, useEffect, useState } from "react";
import { api, type Library } from "../api";
import { apiDb } from "../db/db";
import { startDatabaseOnce } from "../db/startup";
import { reconcile } from "../db/tracks";
import type { MatchResult } from "../domain/matching";

/** Reconcile runs are chained so their database writes never interleave. */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Match MixMap tracks against every new library version (after mixmap.db is ready)
 * and keep the results: missing tracks get flagged in the database, unmatched and
 * ambiguous ones are listed for manual mapping.
 */
export function useReconcile(library: Library | undefined): {
  error?: string;
  /** Match again (e.g. after a manual mapping). */
  rerun: () => void;
  results: MatchResult[];
} {
  const [results, setResults] = useState<MatchResult[]>([]);
  const [error, setError] = useState<string>();
  const [tick, setTick] = useState(0);
  const rerun = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    // An empty library (failed or not yet loaded) would mark every track missing.
    if (!library || library.tracks.length === 0) return;
    let live = true;
    const run = queue.then(async () => {
      await startDatabaseOnce(apiDb, api.setLibrarySource);
      return reconcile(apiDb, library.tracks);
    });
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
  }, [library, tick]);

  return { error, rerun, results };
}
