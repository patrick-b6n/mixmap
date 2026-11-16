import { useCallback, useEffect, useMemo, useState } from "react";
import type { Library, Track } from "@/business/model";
import { useAppServices } from "@/app/app-services";
import { type Link } from "@/business/links";
import { type TrackRow } from "@/business/model";
import { linkCounts } from "@/business/graph";

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
  const services = useAppServices();
  const [links, setLinks] = useState<Link[]>([]);
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [version, setVersion] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    Promise.all([services.links.list(), services.tracks.list()]).then(
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
  }, [tick, library?.version, services.links, services.tracks]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  const libraryById = useMemo(
    () => new Map((library?.tracks ?? []).map((t) => [t.id, t])),
    [library],
  );
  const tracksByKey = useMemo(() => new Map(tracks.map((t) => [t.key, t])), [tracks]);

  const linkCountById = useMemo(() => {
    const byKey = linkCounts(links);
    const byId = new Map<string, number>();
    for (const t of tracks)
      if (t.rekordboxId && !t.missing) byId.set(t.rekordboxId, byKey.get(t.key) ?? 0);
    return (id: string) => byId.get(id) ?? 0;
  }, [links, tracks]);

  return { library: libraryById, linkCountById, links, refresh, tracks: tracksByKey, version };
}
