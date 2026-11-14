import { useEffect, useMemo, useState } from "react";
import { buildTree, findNode, trackIdsOf } from "./domain/playlistTree";
import { PlaylistTree } from "./library/PlaylistTree";
import { TrackTable } from "./library/TrackTable";
import { useLibrary } from "./library/useLibrary";
import { Shell } from "./shell/Shell";

export default function App() {
  const { error, library, refresh, status } = useLibrary();
  const [playlistId, setPlaylistId] = useState<string>();
  const [trackId, setTrackId] = useState<string>();

  const selectedNode = useMemo(() => {
    if (!library || playlistId === undefined) return undefined;
    return findNode(buildTree(library.playlists), playlistId) ?? findNode(buildTree(library.histories), playlistId);
  }, [library, playlistId]);

  // The selected playlist disappeared in a reload: fall back to all tracks.
  useEffect(() => {
    if (library && playlistId !== undefined && !selectedNode) setPlaylistId(undefined);
  }, [library, playlistId, selectedNode]);

  /** Track ids of the selected playlist/folder/history, or undefined = all tracks. */
  const playlistTrackIds = selectedNode ? trackIdsOf(selectedNode) : undefined;

  /** Tracks shown in the table: the selected playlist in its order, or all tracks. */
  const tableTracks = useMemo(() => {
    if (!library) return [];
    if (!playlistTrackIds) return library.tracks;
    const byId = new Map(library.tracks.map((t) => [t.id, t]));
    return playlistTrackIds.flatMap((id) => byId.get(id) ?? []);
  }, [library, playlistTrackIds]);

  const shownError = status?.error ?? error;
  const toolbar = (
    <>
      <button onClick={refresh}>Refresh</button>
      <span className="status" title={status?.location?.dbPath}>
        {status && `${status.trackCount} tracks · ${status.playlistCount} playlists`}
        {shownError && <span className="status-error"> · {shownError}</span>}
      </span>
    </>
  );

  return (
    <Shell
      details={<div className="placeholder">Select a track</div>}
      graph={<div className="placeholder">Graph</div>}
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
          <div className="placeholder">Loading…</div>
        )
      }
      table={
        library ? (
          <TrackTable onSelect={setTrackId} selectedId={trackId} tracks={tableTracks} version={library.version} />
        ) : (
          <div className="placeholder">Loading…</div>
        )
      }
      toolbar={toolbar}
    />
  );
}
