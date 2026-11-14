import { useEffect, useMemo, useState } from "react";
import { buildTree, findNode, trackIdsOf } from "./domain/playlistTree";
import { PlaylistTree } from "./library/PlaylistTree";
import { useLibrary } from "./library/useLibrary";
import { Shell } from "./shell/Shell";

export default function App() {
  const { error, library, refresh, status } = useLibrary();
  const [playlistId, setPlaylistId] = useState<string>();

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
        <div className="placeholder" data-testid="table-placeholder">
          {(playlistTrackIds ?? library?.tracks ?? []).length} tracks
        </div>
      }
      toolbar={toolbar}
    />
  );
}
