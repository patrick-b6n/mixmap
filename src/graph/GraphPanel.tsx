import { Network, X } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Placeholder } from "@/components/Placeholder";
import { Button } from "@/components/ui/button";
import { api } from "../api";
import { apiDb } from "../db/db";
import {
  createLink,
  createLinkStatements,
  deleteLinksStatements,
  getLink,
  type Link,
  listLinks,
  restoreLinks,
} from "../db/links";
import {
  addNodeStatements,
  type GraphNodeRow,
  listNodes,
  moveNodes,
  removeNode,
  removeNodeStatements,
  restoreNode,
} from "../db/nodes";
import { startDatabaseOnce } from "../db/startup";
import { DEFAULT_BPM_TOLERANCE } from "../domain/compatibility";
import { type GraphFilter, isActive, matchingNodes } from "../domain/filters";
import { buildGraph } from "../domain/graph";
import { pathEdges, shortestPaths } from "../domain/paths";
import { portableKey } from "../domain/matching";
import { centeredAt, placeNextTo } from "../domain/placement";
import { type CompatSettings, FilterBar } from "./FilterBar";
import { PathBar } from "./PathBar";
import type { TrackDrop } from "./dnd";
import { GraphCanvas } from "./GraphCanvas";
import type { LinkActions } from "./useLinkActions";
import type { MixmapData } from "./useMixmap";

type Props = {
  actions: LinkActions;
  locate?: { n: number; trackId: string };
  onSelectTrack: (trackId: string | undefined) => void;
  selectedTrackId?: string;
  artworkVersion: number;
  data: MixmapData;
  onDeleteLink: (from: string, to: string) => void;
  onSelectLink: (link: { from: string; to: string } | undefined) => void;
  selectedLink?: { from: string; to: string };
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Upper center area: filters and the graph canvas. */
export function GraphPanel({
  actions,
  artworkVersion,
  data,
  locate,
  onDeleteLink,
  onSelectLink,
  onSelectTrack,
  selectedLink,
  selectedTrackId,
}: Props) {
  /** Links counted when the confirmation opened: exactly these get deleted. */
  const [confirmDeleteAll, setConfirmDeleteAll] = useState<{ links: { from: string; to: string }[]; title: string }>();
  const [error, setError] = useState<string>();
  const [nodes, setNodes] = useState<GraphNodeRow[]>();

  // Graph filters, never applied to the table.
  const [filter, setFilter] = useState<GraphFilter>({});
  const [hideUnmatched, setHideUnmatched] = useState(false);
  const [compat, setCompat] = useState<CompatSettings>({
    bpmTolerance: DEFAULT_BPM_TOLERANCE,
    halfDouble: false,
    on: false,
  });
  const selectedTrack = selectedTrackId ? data.library.get(selectedTrackId) : undefined;
  // "Compatible with selected" follows the selection; without one it doesn't filter.
  const effectiveFilter = useMemo<GraphFilter>(
    () =>
      compat.on && selectedTrack
        ? {
            ...filter,
            compatible: {
              bpmTolerance: compat.bpmTolerance,
              halfDouble: compat.halfDouble,
              reference: { bpm: selectedTrack.bpm, key: selectedTrack.key },
            },
          }
        : filter,
    [filter, compat, selectedTrack],
  );
  // Path-finding between two tracks (keys); the selected path is highlighted.
  const [path, setPath] = useState<{ from?: string; selected: number; to?: string }>();
  const pathFrom = path?.from;
  const pathTo = path?.to;
  const paths = useMemo(
    () => (pathFrom && pathTo ? shortestPaths(data.links, pathFrom, pathTo) : []),
    [pathFrom, pathTo, data.links],
  );
  const shownPath = path ? paths[Math.min(path.selected, paths.length - 1)] : undefined;
  const onGraphKeys = useMemo(() => new Set((nodes ?? []).map((n) => n.trackKey)), [nodes]);
  const trackLabel = (key: string) => trackLabelOf(data, key);

  const filtered = useMemo(() => {
    if (!nodes || !isActive(effectiveFilter)) return undefined;
    const { nodes: cards } = buildGraph(nodes, data.links, data.tracks, data.library);
    const ids = matchingNodes(effectiveFilter, cards, data.links);
    // The reference track itself always stays visible.
    const ref = effectiveFilter.compatible && selectedTrack ? portableKey(selectedTrack) : undefined;
    if (ref && nodes.some((n) => n.trackKey === ref)) ids.add(ref);
    return ids;
  }, [nodes, effectiveFilter, selectedTrack, data.links, data.tracks, data.library]);
  const matched = shownPath ? new Set(shownPath.keys) : filtered;
  const highlightedEdges = useMemo(() => (shownPath ? pathEdges(shownPath.keys) : undefined), [shownPath]);

  // Nodes of the graph; reloaded when shared data changes (e.g. new links).
  useEffect(() => {
    let live = true;
    startDatabaseOnce(apiDb, api.setLibrarySource)
      .then(() => listNodes(apiDb))
      .then(
        (n) => live && setNodes(n),
        (e) => live && setError(String(e)),
      );
    return () => {
      live = false;
    };
    // data.version is a trigger: reload when shared data changed.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [data.version]);

  /**
   * Table track dropped on the canvas. Onto a node: link node → track (Alt: track →
   * node) and place the track beside the node if it isn't on the graph yet. Onto
   * empty canvas: just add it there. No popup either way.
   */
  const dropping = useRef(false);
  const onDropTrack = async ({ onto, position, positions, reverse, trackId }: TrackDrop) => {
    const track = data.library.get(trackId);
    if (!track || dropping.current) return;
    const key = portableKey(track);
    if (onto === key) return;
    const onGraph = positions.some((n) => n.key === key);
    const statements = [];
    try {
      if (onto) {
        const anchor = positions.find((n) => n.key === onto);
        if (!onGraph && anchor) {
          const p = placeNextTo(anchor, positions, reverse ? "left" : "right");
          statements.push(...addNodeStatements(track, p.x, p.y).statements);
        }
        statements.push(
          ...(reverse ? createLinkStatements(track, onto) : createLinkStatements(onto, track)).statements,
        );
      } else if (!onGraph) {
        const p = centeredAt(position);
        statements.push(...addNodeStatements(track, p.x, p.y).statements);
      }
      if (statements.length === 0) return;
      dropping.current = true;
      // Node and link in one transaction: never a node without its link.
      await apiDb.execute(statements);
      data.refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      dropping.current = false;
    }
  };

  const onLink = (source: string, target: string) => {
    createLink(apiDb, source, target).then(data.refresh, (e) => setError(String(e)));
  };

  /** Undo entry + toast for a removed node (and the links removed with it). */
  const offerUndo = (label: string, entry: { label: string; undo: () => Promise<void> }) => {
    actions.undo.push(entry);
    toast(label, {
      action: {
        label: "Undo",
        onClick: () =>
          void actions.run(() => actions.undo.undoEntry(entry)).then(data.refresh, (e) => setError(String(e))),
      },
    });
  };

  /** "Remove from graph": the track's links stay; Undo puts it back where it was. */
  const onRemoveFromGraph = (trackKey: string) => {
    if (selectedLink && (selectedLink.from === trackKey || selectedLink.to === trackKey)) onSelectLink(undefined);
    actions
      .run(async () => {
        // Re-read: Undo must restore the stored position (drags are saved async).
        const node = (await listNodes(apiDb)).find((n) => n.trackKey === trackKey);
        if (!node) return;
        await removeNode(apiDb, trackKey);
        data.refresh();
        offerUndo("Removed from graph", {
          label: "remove from graph",
          undo: async () => {
            if (!(await restoreNode(apiDb, node))) throw new Error("the track no longer exists");
          },
        });
      })
      .catch((e) => setError(String(e)));
  };

  /** Delete key on a card: confirm, then take it off the graph and delete its links. */
  const [confirmDeleteNode, setConfirmDeleteNode] = useState<{
    links: { from: string; to: string }[];
    title: string;
    trackKey: string;
  }>();
  const onDeleteNode = useCallback(
    (trackKey: string) => {
      const links = data.links
        .filter((l) => l.from === trackKey || l.to === trackKey)
        .map((l) => ({ from: l.from, to: l.to }));
      setConfirmDeleteNode({ links, title: trackLabelOf(data, trackKey), trackKey });
    },
    [data],
  );

  /** Node and links go in one transaction; one Undo puts both back. */
  const deleteNode = (trackKey: string, keys: { from: string; to: string }[]) => {
    if (selectedLink && keys.some((l) => l.from === selectedLink.from && l.to === selectedLink.to)) {
      onSelectLink(undefined);
    }
    actions
      .run(async () => {
        // Re-read: Undo must restore what is stored now (drags are saved async).
        const node = (await listNodes(apiDb)).find((n) => n.trackKey === trackKey);
        if (!node) return;
        const links = (await Promise.all(keys.map((k) => getLink(apiDb, k.from, k.to)))).filter(
          (l): l is Link => l !== undefined,
        );
        await apiDb.execute([...removeNodeStatements(trackKey), ...deleteLinksStatements(links)]);
        data.refresh();
        offerUndo(
          links.length === 0 ? "Removed from graph" : `Removed from graph, ${plural(links.length, "link")} deleted`,
          {
            label: "remove from graph",
            undo: async () => {
              if (!(await restoreNode(apiDb, node))) throw new Error("the track no longer exists");
              const restored = await restoreLinks(apiDb, links);
              if (restored < links.length) {
                throw new Error(`${links.length - restored} link(s) could not be restored: their tracks are gone`);
              }
            },
          },
        );
      })
      .catch((e) => setError(String(e)));
  };

  /** "Delete all links of this track": confirm with the count first. */
  const onDeleteAllLinks = (trackKey: string) => {
    const links = data.links
      .filter((l) => l.from === trackKey || l.to === trackKey)
      .map((l) => ({ from: l.from, to: l.to }));
    if (links.length > 0) setConfirmDeleteAll({ links, title: trackLabelOf(data, trackKey) });
  };

  /** Bumped after an auto-layout: remounts the canvas so it shows the new positions. */
  const [layoutRun, setLayoutRun] = useState(0);
  const [layingOut, setLayingOut] = useState(false);

  /** ELK auto-layout of the whole graph, saved at once; Ctrl+Z restores the old positions. */
  const onAutoLayout = () => {
    if (!nodes || nodes.length === 0) return;
    setLayingOut(true);
    actions
      .run(async () => {
        // ELK is large: load it on first use.
        const { autoLayout } = await import("../domain/layout");
        const before = await listNodes(apiDb);
        // Current links, not the ones captured at click time (the task may have waited).
        const positions = await autoLayout(
          before.map((n) => n.trackKey),
          await listLinks(apiDb),
        );
        await moveNodes(
          apiDb,
          positions.map((p) => ({ trackKey: p.key, x: p.x, y: p.y })),
        );
        // Show the new positions right away (the canvas remounts from this list).
        const laidOut = new Map(positions.map((p) => [p.key, p]));
        setNodes(
          before.map((n) => ({ ...n, x: laidOut.get(n.trackKey)?.x ?? n.x, y: laidOut.get(n.trackKey)?.y ?? n.y })),
        );
        setLayoutRun((r) => r + 1);
        data.refresh();
        actions.undo.push({
          label: "auto-layout",
          undo: async () => {
            await moveNodes(apiDb, before);
            setNodes(await listNodes(apiDb));
            setLayoutRun((r) => r + 1);
          },
        });
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLayingOut(false));
  };

  const onLocateMissing = useCallback(() => {
    toast("Not on the graph — drag it from the table to add it.");
  }, []);

  const onMoved = (positions: GraphNodeRow[]) => {
    moveNodes(apiDb, positions).catch((e) => setError(String(e)));
  };

  return (
    <div className="flex h-full flex-col">
      {confirmDeleteAll && (
        <ConfirmDialog
          confirmLabel={`Delete ${plural(confirmDeleteAll.links.length, "link")}`}
          description={`All ${plural(confirmDeleteAll.links.length, "incoming and outgoing link")} of “${
            confirmDeleteAll.title
          }” will be deleted.`}
          onCancel={() => setConfirmDeleteAll(undefined)}
          onConfirm={() => {
            const { links } = confirmDeleteAll;
            setConfirmDeleteAll(undefined);
            if (selectedLink && links.some((l) => l.from === selectedLink.from && l.to === selectedLink.to)) {
              onSelectLink(undefined);
            }
            actions.deleteLinks(links).catch((e) => setError(String(e)));
          }}
          title="Delete all links of this track?"
        />
      )}
      {confirmDeleteNode && (
        <ConfirmDialog
          confirmLabel={
            confirmDeleteNode.links.length === 0
              ? "Remove"
              : `Remove and delete ${plural(confirmDeleteNode.links.length, "link")}`
          }
          description={
            confirmDeleteNode.links.length === 0
              ? `“${confirmDeleteNode.title}” will be taken off the graph. It has no links.`
              : `“${confirmDeleteNode.title}” will be taken off the graph, and all ${plural(
                  confirmDeleteNode.links.length,
                  "incoming and outgoing link",
                )} will be deleted.`
          }
          onCancel={() => setConfirmDeleteNode(undefined)}
          onConfirm={() => {
            const { links, trackKey } = confirmDeleteNode;
            setConfirmDeleteNode(undefined);
            deleteNode(trackKey, links);
          }}
          title="Remove track from graph?"
        />
      )}
      <FilterBar
        active={filtered !== undefined}
        compat={compat}
        filter={filter}
        hide={hideUnmatched}
        matched={filtered?.size ?? nodes?.length ?? 0}
        onChange={setFilter}
        onClear={() => {
          setFilter({});
          setCompat((c) => ({ ...c, on: false }));
        }}
        onCompatChange={setCompat}
        onHideChange={setHideUnmatched}
        selectedLabel={selectedTrack ? `${selectedTrack.artist} – ${selectedTrack.title}` : undefined}
        total={nodes?.length ?? 0}
      >
        {nodes && nodes.length > 1 && (
          <Button disabled={layingOut} onClick={onAutoLayout} title="Arrange the graph left to right (Ctrl+Z to undo)">
            <Network />
            {layingOut ? "Arranging…" : "Auto-layout"}
          </Button>
        )}
      </FilterBar>
      {path && (
        <PathBar
          from={path.from}
          label={trackLabel}
          onClear={() => setPath(undefined)}
          onGraph={onGraphKeys}
          onSelect={(i) => setPath({ ...path, selected: i })}
          paths={paths}
          selected={Math.min(path.selected, Math.max(paths.length - 1, 0))}
          to={path.to}
        />
      )}
      {error && (
        <div className="flex items-center gap-2 border-b px-3 py-1 text-destructive" role="alert">
          <span className="flex-1">{error}</span>
          <Button aria-label="Dismiss" onClick={() => setError(undefined)} size="icon-compact" variant="ghost">
            <X />
          </Button>
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        {nodes ? (
          <>
            <GraphCanvas
              artworkVersion={artworkVersion}
              data={data}
              hideUnmatched={hideUnmatched}
              key={layoutRun}
              locate={locate}
              matched={matched}
              nodes={nodes}
              onDeleteAllLinks={onDeleteAllLinks}
              onDeleteLink={onDeleteLink}
              onDeleteNode={onDeleteNode}
              onDropTrack={(d) => void onDropTrack(d)}
              onLink={onLink}
              onLocateMissing={onLocateMissing}
              onMoved={onMoved}
              onPathFrom={(key) => setPath((p) => ({ from: key, selected: 0, to: p?.to }))}
              onPathTo={(key) => setPath((p) => ({ from: p?.from, selected: 0, to: key }))}
              onRemoveFromGraph={onRemoveFromGraph}
              onSelectLink={onSelectLink}
              onSelectTrack={onSelectTrack}
              pathEdges={highlightedEdges}
              selectedLink={selectedLink}
              selectedTrackId={selectedTrackId}
            />
            {nodes.length === 0 && (
              <Placeholder className="pointer-events-none absolute inset-0 flex items-center justify-center">
                Drag tracks from the table onto the graph to start.
              </Placeholder>
            )}
          </>
        ) : (
          <Placeholder>Loading…</Placeholder>
        )}
      </div>
    </div>
  );
}

/** "Artist – Title" of a stored track key (the key itself when unknown). */
function trackLabelOf(data: MixmapData, key: string): string {
  const t = data.tracks.get(key);
  return t ? `${t.artist} – ${t.title}` : key;
}
