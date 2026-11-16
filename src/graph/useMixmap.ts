import { useCallback, useEffect, useMemo, useState } from "react";
import type { Library, Track } from "../api";
import { appDb } from "@/app/database";
import { type Link, listLinks } from "../db/links";
import { listTracks, type TrackRow } from "../db/tracks";
import { linkCounts } from "../domain/graph";

export type MixmapData = {
  /** Link count per rekordbox track id (for the table's Links column). */
  linkCountById: (rekordboxId: string) => number;
  links: Link[];
  /** rekordbox tracks by id. */
  library: Map<string, Track>;
  /** Reload links and tracks after a change. */
  refresh: () => void;
  tracks: Map<string, TrackRow>;
  /** Increases on every reload, for dependent loads (e.g. graph nodes). */
  version: number;
};

/** mixmap's own data that several views share: all links and stored tracks. */
export function useMixmap(library: Library | undefined): MixmapData {
  const [links, setLinks] = useState<Link[]>([]);
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [version, setVersion] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    Promise.all([listLinks(appDb), listTracks(appDb)]).then(
      ([l, t]) => {
        if (!live) return;
        setLinks(l);
        setTracks(t);
        setVersion((v) => v + 1);
      },
      () => undefined, // surfaced by the views that write
    );
    return () => {
      live = false;
    };
    // Triggers: tick (refresh) and a new library version (reconcile may have
    // updated rekordbox ids / missing flags).
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [tick, library?.version]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  const libraryById = useMemo(() => new Map((library?.tracks ?? []).map((t) => [t.id, t])), [library]);
  const tracksByKey = useMemo(() => new Map(tracks.map((t) => [t.key, t])), [tracks]);

  const linkCountById = useMemo(() => {
    const byKey = linkCounts(links);
    const byId = new Map<string, number>();
    for (const t of tracks) if (t.rekordboxId && !t.missing) byId.set(t.rekordboxId, byKey.get(t.key) ?? 0);
    return (id: string) => byId.get(id) ?? 0;
  }, [links, tracks]);

  return { library: libraryById, linkCountById, links, refresh, tracks: tracksByKey, version };
}
