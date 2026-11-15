import { useCallback, useEffect, useMemo, useState } from "react";
import { Toaster } from "sonner";
import { RefreshCw, Settings } from "lucide-react";
import { Placeholder } from "@/components/Placeholder";
import { Button } from "@/components/ui/button";
import { api } from "./api";
import { apiDb } from "./db/db";
import { startDatabaseOnce } from "./db/startup";
import { buildTree, findNode, trackIdsOf } from "./domain/playlistTree";
import { GraphPanel } from "./graph/GraphPanel";
import { LinkEditor } from "./graph/LinkEditor";
import { useLinkActions } from "./graph/useLinkActions";
import { useMixmap } from "./graph/useMixmap";
import { isTyping } from "./domain/undo";
import { PlaylistTree } from "./library/PlaylistTree";
import { TrackDetails } from "./library/TrackDetails";
import { TrackTable } from "./library/TrackTable";
import { useLibrary } from "./library/useLibrary";
import { useReconcile } from "./library/useReconcile";
import { SettingsDialog } from "./settings/SettingsDialog";
import { Shell } from "./shell/Shell";

export default function App() {
  const { error, library, refresh, status } = useLibrary();
  const [playlistId, setPlaylistId] = useState<string>();
  const [trackId, setTrackId] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dbError, setDbError] = useState<string>();
  const { error: matchError, results: matches } = useReconcile(library);
  const mixmap = useMixmap(library);
  const [actionError, setActionError] = useState<string>();
  const onActionError = useCallback((m: string) => setActionError(m), []);
  const linkActions = useLinkActions(mixmap.refresh, onActionError);
  const [selectedLinkId, setSelectedLinkId] = useState<{ from: string; to: string }>();
  const selectedLink = selectedLinkId
    ? mixmap.links.find((l) => l.from === selectedLinkId.from && l.to === selectedLinkId.to)
    : undefined;

  /** "Artist – Title" of a stored track key. */
  const trackLabel = (key: string) => {
    const t = mixmap.tracks.get(key);
    return t ? `${t.artist} – ${t.title}` : key;
  };

  const deleteLink = useCallback(
    (from: string, to: string) => {
      const link = mixmap.links.find((l) => l.from === from && l.to === to);
      if (!link) return;
      setSelectedLinkId(undefined);
      linkActions.deleteLinks([link]).catch((e) => setActionError(String(e)));
    },
    [mixmap.links, linkActions],
  );

  // Delete key removes the selected link (no confirmation; Ctrl+Z undoes) — only when
  // focus is on the page or the canvas, never in a field, button or dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const onCanvas = target === document.body || target.closest?.(".react-flow") !== null;
      if (e.key === "Delete" && selectedLink && onCanvas && !isTyping(target)) {
        e.preventDefault();
        deleteLink(selectedLink.from, selectedLink.to);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedLink, deleteLink]);
  const missingCount = matches.filter((m) => m.kind === "missing").length;
  const unmatchedCount = matches.filter((m) => m.kind === "unmatched" || m.kind === "ambiguous").length;

  // Once: prepare mixmap.db and restore persisted settings (e.g. the library source).
  useEffect(() => {
    startDatabaseOnce(apiDb, api.setLibrarySource).catch((e) => setDbError(`mixmap.db: ${String(e)}`));
  }, []);

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

  const shownError = actionError ?? dbError ?? matchError ?? status?.error ?? error;
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
        {missingCount > 0 && ` · ${missingCount} missing`}
        {unmatchedCount > 0 && ` · ${unmatchedCount} unmatched`}
        {shownError && <span className="text-destructive"> · {shownError}</span>}
      </span>
    </>
  );

  return (
    <>
      <Toaster position="bottom-center" theme="dark" toastOptions={{ className: "!text-[13px]" }} />
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} status={status} />}
      <Shell
        details={
          selectedLink ? (
            <LinkEditor
              fromLabel={trackLabel(selectedLink.from)}
              link={selectedLink}
              onDelete={() => deleteLink(selectedLink.from, selectedLink.to)}
              onUpdate={(patch) =>
                linkActions
                  .updateLink(selectedLink.from, selectedLink.to, patch)
                  .catch((e) => setActionError(String(e)))
              }
              toLabel={trackLabel(selectedLink.to)}
            />
          ) : (
            <TrackDetails track={selectedTrack} version={library?.version ?? 0} />
          )
        }
        graph={
          <GraphPanel
            artworkVersion={library?.version ?? 0}
            data={mixmap}
            onDeleteLink={deleteLink}
            onSelectLink={setSelectedLinkId}
            selectedLink={selectedLinkId}
          />
        }
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
              linkCount={mixmap.linkCountById}
              onSelect={(id) => {
                setTrackId(id);
                setSelectedLinkId(undefined);
              }}
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
