import { useCallback, useEffect, useState } from "react";
import { api, subscribe, type LibraryStatus } from "./api";

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
    api.refresh().then(setStatus, (e) => setError(String(e)));
  }, []);

  return (
    <main style={{ padding: 16 }}>
      <button onClick={refresh}>Refresh</button>{" "}
      {status && (
        <span data-testid="library-status">
          v{status.version}: {status.trackCount} tracks, {status.playlistCount} playlists
          {status.error && ` — ${status.error}`}
        </span>
      )}
      {error && <span>{error}</span>}
    </main>
  );
}
