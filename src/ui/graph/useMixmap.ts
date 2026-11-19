import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { useAppServices } from "@/app/app-services";
import { linkCounts } from "@/business/graph";
import type { Link } from "@/business/links";
import type { Library, Track, TrackRow } from "@/business/model";

import { queryKeys, useRefreshMixmap } from "../queries";

export type MixmapData = {
  /** Link count per rekordbox track id (for the table's Links column). */
  linkCountById: (rekordboxId: string) => number;
  links: Link[];
  /** rekordbox tracks by id. */
  library: Map<string, Track>;
  /** Reload links, tracks and the graph after a change. */
  refresh: () => void;
  tracks: Map<string, TrackRow>;
  /** Changes on every reload, for dependent views. */
  version: number;
};

const NO_LINKS: Link[] = [];
const NO_TRACKS: TrackRow[] = [];

/** mixmap's own data that several views share: all links and stored tracks. */
export function useMixmap(library: Library | undefined): MixmapData {
  const services = useAppServices();
  const refresh = useRefreshMixmap();
  // Per library version: matching may have updated rekordbox ids / missing flags.
  const { data, dataUpdatedAt } = useQuery({
    queryKey: [...queryKeys.mixmap, library?.version],
    queryFn: async () => {
      const [links, tracks] = await Promise.all([services.links.list(), services.tracks.list()]);
      return { links, tracks };
    },
    placeholderData: keepPreviousData,
  });
  const links = data?.links ?? NO_LINKS;
  const tracks = data?.tracks ?? NO_TRACKS;

  const libraryById = useMemo(
    () => new Map((library?.tracks ?? []).map((t) => [t.id, t])),
    [library],
  );
  const tracksByKey = useMemo(() => new Map(tracks.map((t) => [t.key, t])), [tracks]);

  const linkCountById = useMemo(() => {
    const byKey = linkCounts(links);
    const byId = new Map<string, number>();
    for (const t of tracks) {
      if (t.rekordboxId && !t.missing) byId.set(t.rekordboxId, byKey.get(t.key) ?? 0);
    }
    return (id: string) => byId.get(id) ?? 0;
  }, [links, tracks]);

  return {
    library: libraryById,
    linkCountById,
    links,
    refresh,
    tracks: tracksByKey,
    version: dataUpdatedAt,
  };
}
