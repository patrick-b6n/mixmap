import { useMemo, useState } from "react";
import { RefreshCw, Settings } from "lucide-react";
import { Placeholder } from "@/components/Placeholder";
import { Button } from "@/components/ui/button";
import { buildTree, findNode, trackIdsOf } from "./domain/playlistTree";
import { PlaylistTree } from "./library/PlaylistTree";
import { TrackDetails } from "./library/TrackDetails";
import { TrackTable } from "./library/TrackTable";
import { useLibrary } from "./library/useLibrary";
import { SettingsDialog } from "./settings/SettingsDialog";
import { Shell } from "./shell/Shell";

export default function App() {
  const { error, library, refresh, status } = useLibrary();
  const [playlistId, setPlaylistId] = useState<string>();
  const [trackId, setTrackId] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const selectedNode = useMemo(() => {
    if (!library || playlistId === undefined) return undefined;
    return findNode(buildTree(library.playlists), playlistId) ?? findNode(buildTree(library.histories), playlistId);
  }, [library, playlistId]);

  // A selected playlist that disappeared in a reload simply selects nothing (= all
  // tracks): everything below derives from `selectedNode`, not from `playlistId`.

  /** Track ids of the selected playlist/folder/history, or undefined = all tracks. */
  const playlistTrackIds = selectedNode ? trackIdsOf(selectedNode) : undefined;

  /** Tracks shown in the table: the selected playlist in its order, or all tracks. */
  const tableTracks = useMemo(() => {
    if (!library) return [];
    if (!playlistTrackIds) return library.tracks;
    const byId = new Map(library.tracks.map((t) => [t.id, t]));
    return playlistTrackIds.flatMap((id) => byId.get(id) ?? []);
  }, [library, playlistTrackIds]);

  const selectedTrack = useMemo(() => library?.tracks.find((t) => t.id === trackId), [library, trackId]);

  const shownError = status?.error ?? error;
  const toolbar = (
    <>
      <Button onClick={refresh}>
        <RefreshCw />
        Refresh
      </Button>
      <Button onClick={() => setSettingsOpen(true)}>
        <Settings />
        Settings
      </Button>
      <span className="truncate text-muted-foreground" data-testid="status" title={status?.location?.dbPath}>
        {status && `${status.trackCount} tracks · ${status.playlistCount} playlists`}
        {shownError && <span className="text-destructive"> · {shownError}</span>}
      </span>
    </>
  );

  return (
    <>
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} status={status} />}
      <Shell
        details={<TrackDetails track={selectedTrack} version={library?.version ?? 0} />}
        graph={<Placeholder>Graph</Placeholder>}
        playlists={
          library ? (
            <PlaylistTree
              histories={library.histories}
              onSelect={setPlaylistId}
              playlists={library.playlists}
              selectedId={selectedNode?.playlist.id}
              trackCount={library.tracks.length}
            />
          ) : (
            <Placeholder>Loading…</Placeholder>
          )
        }
        table={
          library ? (
            <TrackTable
              onSelect={setTrackId}
              selectedId={selectedTrack?.id}
              tracks={tableTracks}
              version={library.version}
            />
          ) : (
            <Placeholder>Loading…</Placeholder>
          )
        }
        toolbar={toolbar}
      />
    </>
  );
}
