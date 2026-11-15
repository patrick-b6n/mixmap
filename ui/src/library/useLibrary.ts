import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Library, type LibraryStatus, subscribe } from "../api";
import { fillSmartPlaylists } from "../domain/smartlists";

export type LibraryState = {
  error?: string;
  library?: Library;
  refresh: () => void;
  status?: LibraryStatus;
};

/** The rekordbox library, refetched whenever the backend reports a new version. */
export function useLibrary(): LibraryState {
  const [library, setLibrary] = useState<Library>();
  const [status, setStatus] = useState<LibraryStatus>();
  const [error, setError] = useState<string>();
  /** Version of the library currently shown (or being fetched). */
  const versionRef = useRef<number>(undefined);

  useEffect(() => {
    let live = true;
    let request = 0;
    const loadLibrary = () => {
      const mine = ++request;
      api.library().then(
        (l) => {
          // Ignore responses that arrive after a newer request was started.
          if (!live || mine !== request) return;
          versionRef.current = l.version;
          // Smart playlists: evaluate their rules against this library.
          setLibrary({ ...l, playlists: fillSmartPlaylists(l.playlists, l.tracks) });
          setError(undefined);
        },
        (e) => live && mine === request && setError(String(e)),
      );
    };
    const loadAll = () => {
      api.libraryStatus().then(
        (s) => live && setStatus(s),
        (e) => live && setError(String(e)),
      );
      loadLibrary();
    };
    loadAll();
    const offLibrary = subscribe("library", (s) => {
      const next = s as LibraryStatus;
      setStatus(next);
      if (versionRef.current !== next.version) {
        versionRef.current = next.version;
        loadLibrary();
      }
    });
    const offReconnect = subscribe("reconnect", loadAll);
    return () => {
      live = false;
      offLibrary();
      offReconnect();
    };
  }, []);

  const refresh = useCallback(() => {
    setError(undefined);
    // The backend announces the reload as a "library" event, which refetches.
    api.refresh().then(setStatus, (e) => setError(String(e)));
  }, []);

  return { error, library, refresh, status };
}
