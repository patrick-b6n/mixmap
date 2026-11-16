import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Settings, Unlink } from "lucide-react";
import { Placeholder } from "@/ui/components/Placeholder";
import { Button } from "@/ui/components/ui/button";
import { useAppServices } from "@/app/app-services";
import { type Playlist } from "@/business/model";
import { buildTree, findNode, trackIdsOf } from "@/business/playlistTree";
import { GraphPanel } from "@/ui/graph/GraphPanel";
import { LinkEditor } from "@/ui/graph/LinkEditor";
import { useLinkActions } from "@/ui/graph/useLinkActions";
import { useMixmap } from "@/ui/graph/useMixmap";
import { trackLinks } from "@/business/graph";
import { portableKey } from "@/business/matching";
import { isTyping } from "@/business/undo";
import { PairImportDialog } from "@/ui/library/PairImportDialog";
import { PlaylistTree } from "@/ui/library/PlaylistTree";
import { TrackDetails } from "@/ui/library/TrackDetails";
import { TrackTable } from "@/ui/library/TrackTable";
import { UnmatchedDialog } from "@/ui/library/UnmatchedDialog";
import { useLibrary } from "@/ui/library/useLibrary";
import { useReconcile } from "@/ui/library/useReconcile";
import { inTauri } from "@/app/backend";
import { OverlayMenu } from "@/ui/desktop/OverlayMenu";
import { UpdateBanner } from "@/ui/desktop/UpdateBanner";
import { PairRequestDialog } from "@/ui/settings/PairRequestDialog";
import { SettingsDialog } from "@/ui/settings/SettingsDialog";
import { useSyncResponder } from "@/ui/sync/useSyncResponder";
import { Shell } from "@/ui/shell/Shell";
import { m } from "@/paraglide/messages.js";

export function MainWindow() {
  const services = useAppServices();
  const { error, library, refresh, status } = useLibrary();
  const [playlistId, setPlaylistId] = useState<string>();
  const [trackId, setTrackId] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dbError, setDbError] = useState<string>();
  const { error: matchError, rerun: rematch, results: matches } = useReconcile(library);
  const [unmatchedOpen, setUnmatchedOpen] = useState(false);
  const [importFrom, setImportFrom] = useState<Playlist>();
  const mixmap = useMixmap(library);
  const refreshMixmap = mixmap.refresh;
  /** mixmap data changed outside the normal flows (import, reset, sync): re-match and reload. */
  const dataChanged = useCallback(() => {
    rematch();
    refreshMixmap();
  }, [rematch, refreshMixmap]);
  useSyncResponder(mixmap.library, dataChanged);
  const [actionError, setActionError] = useState<string>();
  const onActionError = useCallback((message: string) => setActionError(message), []);
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
  const missingCount = matches.filter((r) => r.kind === "missing").length;
  const unmatchedCount = matches.filter(
    (r) => r.kind === "unmatched" || r.kind === "ambiguous",
  ).length;

  // Once: prepare mixmap.db and restore persisted settings (e.g. the library source).
  useEffect(() => {
    services
      .restoreSettings()
      .catch((e: unknown) => setDbError(m.main_db_error({ error: String(e) })));
  }, [services]);

  const selectedNode = useMemo(() => {
    if (!library || playlistId === undefined) return undefined;
    return (
      findNode(buildTree(library.playlists), playlistId) ??
      findNode(buildTree(library.histories), playlistId)
    );
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

  const selectedTrack = useMemo(
    () => library?.tracks.find((t) => t.id === trackId),
    [library, trackId],
  );
  const [locate, setLocate] = useState<{ n: number; trackId: string }>();
  const locateTrack = useCallback(
    (id: string) => setLocate((l) => ({ n: (l?.n ?? 0) + 1, trackId: id })),
    [],
  );

  /** Incoming/outgoing links of the selected track, for the details panel. */
  const selectedLinks = useMemo(() => {
    if (!selectedTrack) return { incoming: [], outgoing: [] };
    const { incoming, outgoing } = trackLinks(mixmap.links, portableKey(selectedTrack));
    const label = (key: string) => {
      const t = mixmap.tracks.get(key);
      return t ? `${t.artist} – ${t.title}` : key;
    };
    const item = (l: (typeof mixmap.links)[number], other: string) => ({
      comment: l.comment,
      from: l.from,
      label: label(other),
      rating: l.rating,
      to: l.to,
    });
    return {
      incoming: incoming.map((l) => item(l, l.from)),
      outgoing: outgoing.map((l) => item(l, l.to)),
    };
  }, [selectedTrack, mixmap.links, mixmap.tracks]);

  // Ctrl+L: locate the selected track in the graph.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "l" &&
        trackId &&
        !isTyping(e.target)
      ) {
        e.preventDefault();
        locateTrack(trackId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [trackId, locateTrack]);

  const shownError = actionError ?? dbError ?? matchError ?? status?.error ?? error;
  const toolbar = (
    <>
      <Button onClick={refresh}>
        <RefreshCw />
        {m.main_refresh()}
      </Button>
      <Button onClick={() => setSettingsOpen(true)}>
        <Settings />
        {m.settings_title()}
      </Button>
      {inTauri() && <OverlayMenu />}
      {missingCount + unmatchedCount > 0 && (
        <Button onClick={() => setUnmatchedOpen(true)} title={m.main_unmatched_hint()}>
          <Unlink />
          {m.main_unmatched({ count: missingCount + unmatchedCount })}
        </Button>
      )}
      <span
        className="truncate text-muted-foreground"
        data-testid="status"
        title={status?.location?.dbPath}
      >
        {status &&
          m.main_status({
            playlists: m.main_playlists({ count: status.playlistCount }),
            tracks: m.tracks_count({ count: status.trackCount }),
          })}
        {missingCount > 0 && ` · ${m.main_missing({ count: missingCount })}`}
        {unmatchedCount > 0 && ` · ${m.main_unmatched_count({ count: unmatchedCount })}`}
        {shownError && <span className="text-destructive"> · {shownError}</span>}
      </span>
    </>
  );

  return (
    <>
      <PairRequestDialog />
      {settingsOpen && (
        <SettingsDialog
          library={mixmap.library}
          onClose={() => setSettingsOpen(false)}
          onDataChanged={dataChanged}
          status={status}
        />
      )}
      {importFrom && (
        <PairImportDialog
          library={mixmap.library}
          links={mixmap.links}
          onClose={() => setImportFrom(undefined)}
          onCreated={mixmap.refresh}
          playlist={importFrom}
        />
      )}
      {unmatchedOpen && library && (
        <UnmatchedDialog
          library={library.tracks}
          onClose={() => setUnmatchedOpen(false)}
          onMapped={() => {
            rematch();
            mixmap.refresh();
          }}
          results={matches}
          tracks={mixmap.tracks}
        />
      )}
      <Shell
        banner={<UpdateBanner />}
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
            <TrackDetails
              incoming={selectedLinks.incoming}
              onSelectLink={setSelectedLinkId}
              outgoing={selectedLinks.outgoing}
              track={selectedTrack}
              version={library?.version ?? 0}
            />
          )
        }
        graph={
          <GraphPanel
            actions={linkActions}
            artworkVersion={library?.version ?? 0}
            data={mixmap}
            locate={locate}
            onDeleteLink={deleteLink}
            onSelectLink={setSelectedLinkId}
            // A missing card has no rekordbox track: clear the selection.
            onSelectTrack={setTrackId}
            selectedLink={selectedLinkId}
            selectedTrackId={selectedTrack?.id}
          />
        }
        playlists={
          library ? (
            <PlaylistTree
              histories={library.histories}
              onImportPairs={setImportFrom}
              onSelect={setPlaylistId}
              playlists={library.playlists}
              selectedId={selectedNode?.playlist.id}
              trackCount={library.tracks.length}
            />
          ) : (
            <Placeholder>{m.common_loading()}</Placeholder>
          )
        }
        table={
          library ? (
            <TrackTable
              linkCount={mixmap.linkCountById}
              onLocate={(id) => {
                setTrackId(id);
                locateTrack(id);
              }}
              onSelect={(id) => {
                setTrackId(id);
                setSelectedLinkId(undefined);
              }}
              selectedId={selectedTrack?.id}
              tracks={tableTracks}
              version={library.version}
            />
          ) : (
            <Placeholder>{m.common_loading()}</Placeholder>
          )
        }
        toolbar={toolbar}
      />
    </>
  );
}
