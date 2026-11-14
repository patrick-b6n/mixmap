import { useEffect, useRef, useState } from "react";
import { api, type LibrarySource, type LibraryStatus } from "../api";
import "./settings.css";

type Props = {
  onClose: () => void;
  status?: LibraryStatus;
};

type Kind = LibrarySource["kind"];

/** Settings: where the rekordbox library comes from. */
export function SettingsDialog({ onClose, status }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const current = status?.source ?? { kind: "auto" };
  const [kind, setKindState] = useState<Kind>(current.kind);
  const [path, setPath] = useState(current.kind === "auto" ? "" : current.path);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>();

  /** A path only makes sense for its kind: switching clears it. */
  const setKind = (k: Kind) => {
    setKindState(k);
    setPath(current.kind === k && current.kind !== "auto" ? current.path : "");
    setResult(undefined);
  };

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const apply = async () => {
    const source: LibrarySource = kind === "auto" ? { kind } : { kind, path: path.trim() };
    if (source.kind !== "auto" && !source.path) {
      setResult("Enter a path.");
      return;
    }
    setBusy(true);
    setResult(undefined);
    try {
      const s = await api.setLibrarySource(source);
      setResult(s.error ? `Error: ${s.error}` : `Loaded ${s.trackCount} tracks, ${s.playlistCount} playlists.`);
    } catch (e) {
      setResult(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog className="settings" onClose={onClose} ref={ref}>
      <h2>Settings</h2>
      <fieldset>
        <legend>rekordbox library</legend>
        <label>
          <input checked={kind === "auto"} onChange={() => setKind("auto")} type="radio" />
          Automatic (rekordbox's own master.db)
        </label>
        <label>
          <input checked={kind === "masterDb"} onChange={() => setKind("masterDb")} type="radio" />
          Specific master.db
        </label>
        <label>
          <input checked={kind === "xml"} onChange={() => setKind("xml")} type="radio" />
          rekordbox XML export (File → Export Collection in xml format)
        </label>
        {kind !== "auto" && (
          <input
            aria-label="Path"
            className="settings-path"
            onChange={(e) => setPath(e.target.value)}
            placeholder={kind === "xml" ? "C:\\Users\\…\\rekordbox.xml" : "C:\\Users\\…\\master.db"}
            value={path}
          />
        )}
        {status?.location && <div className="settings-note">Current: {status.location.dbPath}</div>}
      </fieldset>
      {result && <div className="settings-result">{result}</div>}
      <div className="settings-actions">
        <button disabled={busy} onClick={apply}>
          {busy ? "Loading…" : "Apply"}
        </button>
        <button onClick={() => ref.current?.close()}>Close</button>
      </div>
    </dialog>
  );
}
