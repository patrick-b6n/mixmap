import { useCallback, useEffect, useState } from "react";
import { api, type LibraryStatus, subscribe } from "./api";
import { Shell } from "./shell/Shell";

export default function App() {
  const [status, setStatus] = useState<LibraryStatus>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let live = true;
    const load = () =>
      api.libraryStatus().then(
        (s) => live && setStatus(s),
        (e) => live && setError(String(e)),
      );
    load();
    const offLibrary = subscribe("library", (s) => setStatus(s as LibraryStatus));
    const offReconnect = subscribe("reconnect", load);
    return () => {
      live = false;
      offLibrary();
      offReconnect();
    };
  }, []);

  const refresh = useCallback(() => {
    setError(undefined);
    api.refresh().then(setStatus, (e) => setError(String(e)));
  }, []);

  const toolbar = (
    <>
      <button onClick={refresh}>Refresh</button>
      <span className="status" title={status?.location?.dbPath}>
        {status && `${status.trackCount} tracks · ${status.playlistCount} playlists`}
        {(status?.error ?? error) && <span className="status-error"> · {status?.error ?? error}</span>}
      </span>
    </>
  );

  return (
    <Shell
      details={<div className="placeholder">Select a track</div>}
      graph={<div className="placeholder">Graph</div>}
      playlists={<div className="placeholder">Playlists</div>}
      table={<div className="placeholder">Tracks</div>}
      toolbar={toolbar}
    />
  );
}
