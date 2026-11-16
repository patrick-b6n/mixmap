import "@xyflow/react/dist/style.css";
import {
  applyNodeChanges,
  Background,
  Controls,
  MarkerType,
  MiniMap,
  type NodeChange,
  ReactFlow,
} from "@xyflow/react";
import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactFlowInstance } from "@xyflow/react";
import type { GraphNodeRow } from "@/business/model";
import { ContextMenu, type ContextMenuItem } from "@/ui/components/ContextMenu";
import { buildGraph, canLink, edgeId } from "@/business/graph";
import { isTyping } from "@/business/undo";
import { LinkEdge, type LinkFlowEdge } from "./LinkEdge";
import { TrackNode, type TrackFlowNode } from "./TrackNode";
import { TRACK_MIME, type TrackDrop } from "./dnd";
import type { MixmapData } from "./useMixmap";
import { m } from "@/paraglide/messages.js";

const nodeTypes = { track: TrackNode };

const isTrackDrag = (e: DragEvent) => e.dataTransfer.types.includes(TRACK_MIME);

/** Accept only mixmap track drags (shows the "link" cursor). */
function onDragOver(e: DragEvent<HTMLDivElement>) {
  if (!isTrackDrag(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "link";
}

const edgeTypes = { link: LinkEdge };

type Props = {
  artworkVersion: number;
  data: MixmapData;
  /** Nodes matching the graph filter (undefined = no filter); the others are dimmed or hidden. */
  matched?: Set<string>;
  /** Hide non-matching nodes instead of dimming them. */
  hideUnmatched: boolean;
  /** Edge ids of the highlighted path. */
  pathEdges?: Set<string>;
  /** Context menu: start / end a path at this track. */
  onPathFrom: (trackKey: string) => void;
  onPathTo: (trackKey: string) => void;
  nodes: GraphNodeRow[];
  /** A table track was dropped on the canvas. */
  onDropTrack: (drop: TrackDrop) => void;
  /** Persist positions of nodes the user dragged. */
  onMoved: (positions: { trackKey: string; x: number; y: number }[]) => void;
  /** Delete every link of a track (card context menu; asks for confirmation). */
  onDeleteAllLinks: (trackKey: string) => void;
  /** Delete key on a selected card: take it off the graph with its links (asks first). */
  onDeleteNode: (trackKey: string) => void;
  /** Request to center a track (double-click / Ctrl+L); `n` changes per request. */
  locate?: { n: number; trackId: string };
  /** The located track isn't on the graph. */
  onLocateMissing: () => void;
  /** Card click: select its rekordbox track (undefined for missing tracks). */
  onSelectTrack: (trackId: string | undefined) => void;
  /** Remove a link (context menu "Remove"). */
  onDeleteLink: (from: string, to: string) => void;
  /** A connection was dragged from `source`'s right handle onto `target`. */
  onLink: (source: string, target: string) => void;
  /** Take a track off the graph (card context menu; links stay). */
  onRemoveFromGraph: (trackKey: string) => void;
  /** Click on a link selects it; click on empty canvas clears the selection. */
  onSelectLink: (link: { from: string; to: string } | undefined) => void;
  selectedLink?: { from: string; to: string };
  /** Track selected in the table: its card is highlighted (no pan/zoom). */
  selectedTrackId?: string;
};

/** The graph: track cards and directed links. Re-key it to show new stored positions. */
export function GraphCanvas({
  artworkVersion,
  data,
  hideUnmatched,
  locate,
  matched,
  onPathFrom,
  onPathTo,
  pathEdges,
  nodes: storedNodes,
  onDeleteAllLinks,
  onDeleteLink,
  onDeleteNode,
  onDropTrack,
  onLocateMissing,
  onLink,
  onMoved,
  onRemoveFromGraph,
  onSelectLink,
  onSelectTrack,
  selectedLink,
  selectedTrackId,
}: Props) {
  const [menu, setMenu] = useState<{ items: ContextMenuItem[]; x: number; y: number }>();
  const closeMenu = useCallback(() => setMenu(undefined), []);
  const flow = useRef<ReactFlowInstance<TrackFlowNode, LinkFlowEdge>>(null);
  const graph = useMemo(
    () => buildGraph(storedNodes, data.links, data.tracks, data.library),
    [storedNodes, data.links, data.tracks, data.library],
  );

  // One selection for table and graph: the selected track's card is the selected node.
  // A card whose track is missing in rekordbox has no track id, so selecting it on the
  // graph is remembered here (until a track is selected).
  const [missingKey, setMissingKey] = useState<string>();
  if (selectedTrackId !== undefined && missingKey !== undefined) setMissingKey(undefined);
  const selectedKey =
    selectedTrackId !== undefined
      ? graph.nodes.find((n) => n.card.track?.id === selectedTrackId)?.id
      : missingKey;
  /** Click on (or start dragging) a card: it becomes the selected track. */
  const selectNode = (node: TrackFlowNode) => {
    onSelectLink(undefined);
    const trackId = node.data.card.track?.id;
    setMissingKey(trackId === undefined ? node.id : undefined);
    onSelectTrack(trackId);
  };

  const fromGraph = useMemo<TrackFlowNode[]>(
    () =>
      graph.nodes.map((n) => ({
        data: {
          artworkVersion,
          card: n.card,
          dimmed: matched !== undefined && !matched.has(n.id),
          highlighted: n.id === selectedKey,
        },
        // React Flow also hides the links of hidden nodes.
        hidden: hideUnmatched && matched !== undefined && !matched.has(n.id),
        id: n.id,
        position: { x: n.x, y: n.y },
        selected: n.id === selectedKey,
        type: "track",
      })),
    [graph.nodes, artworkVersion, selectedKey, matched, hideUnmatched],
  );

  // The canvas owns positions once a node is shown (drags are saved from here, so a
  // reload racing a save must not snap nodes back). Reloads add/remove nodes and update
  // card data and selection; only new nodes take their stored position.
  const [nodes, setNodes] = useState<TrackFlowNode[]>(fromGraph);
  const [source, setSource] = useState(fromGraph);
  if (source !== fromGraph) {
    setSource(fromGraph);
    const shown = new Map(nodes.map((n) => [n.id, n]));
    setNodes(
      fromGraph.map((n) => {
        const cur = shown.get(n.id);
        // Keep React Flow's measurements too: without them edges vanish until re-measured.
        return cur
          ? { ...n, dragging: cur.dragging, measured: cur.measured, position: cur.position }
          : n;
      }),
    );
  }

  const edges = useMemo<LinkFlowEdge[]>(
    () =>
      graph.edges.map((e) => ({
        data: {
          comment: e.comment,
          dimmed: pathEdges
            ? !pathEdges.has(e.id)
            : matched !== undefined && !(matched.has(e.from) && matched.has(e.to)),
          onPath: pathEdges?.has(e.id) ?? false,
          rating: e.rating,
          width: e.width,
        },
        id: e.id,
        markerEnd: {
          color: pathEdges?.has(e.id) ? "var(--primary)" : "var(--muted-foreground)",
          // Marker size is in stroke widths: divide so every arrow looks the same.
          height: 24 / e.width,
          type: MarkerType.ArrowClosed,
          width: 24 / e.width,
        },
        selected: selectedLink !== undefined && e.id === edgeId(selectedLink.from, selectedLink.to),
        source: e.from,
        target: e.to,
        type: "link",
      })),
    [graph.edges, selectedLink, matched, pathEdges],
  );

  // Double-click / Ctrl+L in the table: center that track's card (keeping zoom >= 1).
  const lastLocate = useRef(locate?.n);
  useEffect(() => {
    const f = flow.current;
    // Not ready yet: keep the request until the canvas is initialized.
    if (!locate || locate.n === lastLocate.current || !f) return;
    lastLocate.current = locate.n;
    const node = nodes.find((n) => n.data.card.track?.id === locate.trackId);
    if (!node) {
      onLocateMissing();
      return;
    }
    const w = node.measured?.width ?? 208;
    const h = node.measured?.height ?? 56;
    void f.setCenter(node.position.x + w / 2, node.position.y + h / 2, {
      duration: 300,
      zoom: Math.max(f.getZoom(), 1),
    });
  }, [locate, nodes, onLocateMissing]);

  // Delete key with one card selected (and no link): remove it from the graph with its
  // links. Only when focus is on the page or the canvas, never in a field or dialog.
  const selectedNode = nodes.some((n) => n.id === selectedKey && !n.hidden)
    ? selectedKey
    : undefined;
  useEffect(() => {
    if (!selectedNode || selectedLink) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const onCanvas = target === document.body || target.closest?.(".react-flow") !== null;
      if (e.key !== "Delete" || !onCanvas || isTyping(target)) return;
      e.preventDefault();
      onDeleteNode(selectedNode);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedNode, selectedLink, onDeleteNode]);

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!isTrackDrag(e) || !flow.current) return;
    e.preventDefault();
    // Dropping on the minimap or the zoom controls means nothing.
    if ((e.target as Element).closest(".react-flow__minimap, .react-flow__controls")) return;
    const trackId = e.dataTransfer.getData(TRACK_MIME);
    const node = (e.target as Element).closest(".react-flow__node");
    onDropTrack({
      onto: node?.getAttribute("data-id") ?? undefined,
      position: flow.current.screenToFlowPosition({ x: e.clientX, y: e.clientY }),
      positions: flow.current
        .getNodes()
        .map((n) => ({ key: n.id, x: n.position.x, y: n.position.y })),
      reverse: e.altKey,
      trackId,
    });
  };

  return (
    <div className="h-full" onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow<TrackFlowNode, LinkFlowEdge>
        colorMode="dark"
        edgeTypes={edgeTypes}
        edges={edges}
        // Fit once when the canvas mounts.
        fitView
        fitViewOptions={{ maxZoom: 1.2, padding: 0.2 }}
        // Links are drawn from a node's right handle; dragging the card only moves it.
        connectionRadius={40}
        // Deleting is handled by mixmap (links only, with undo), never by React Flow.
        deleteKeyCode={null}
        isValidConnection={(c) => canLink(data.links, c.source, c.target)}
        nodeTypes={nodeTypes}
        nodes={nodes}
        // A click that moves a few pixels is still a click, not a drag.
        nodeDragThreshold={5}
        // Moving a card selects it too (a drag never fires a click).
        onNodeDragStart={(_e, node) => selectNode(node)}
        onNodeDragStop={(_e, _node, dragged) =>
          onMoved(dragged.map((n) => ({ trackKey: n.id, x: n.position.x, y: n.position.y })))
        }
        onConnect={(c) => onLink(c.source, c.target)}
        onEdgeClick={(_e, edge) => onSelectLink({ from: edge.source, to: edge.target })}
        onEdgeContextMenu={(e, edge) => {
          e.preventDefault();
          onSelectLink({ from: edge.source, to: edge.target });
          setMenu({
            items: [
              {
                destructive: true,
                label: m.canvas_remove_link(),
                onSelect: () => onDeleteLink(edge.source, edge.target),
              },
            ],
            x: e.clientX,
            y: e.clientY,
          });
        }}
        onNodeContextMenu={(e, node) => {
          e.preventDefault();
          const count = node.data.card.linkCount;
          setMenu({
            items: [
              { label: m.canvas_path_from(), onSelect: () => onPathFrom(node.id) },
              { label: m.canvas_path_to(), onSelect: () => onPathTo(node.id) },
              { label: m.canvas_remove_from_graph(), onSelect: () => onRemoveFromGraph(node.id) },
              ...(count > 0
                ? [
                    {
                      destructive: true,
                      label: m.canvas_delete_all_links({ count }),
                      onSelect: () => onDeleteAllLinks(node.id),
                    },
                  ]
                : []),
            ],
            x: e.clientX,
            y: e.clientY,
          });
        }}
        onNodeClick={(_e, node) => selectNode(node)}
        onPaneClick={() => onSelectLink(undefined)}
        // Dropped on a card but not near its handle: link to that card anyway.
        onConnectEnd={(event, state) => {
          if (state.isValid || !state.fromNode || state.fromHandle?.type !== "source") return;
          const point = "changedTouches" in event ? event.changedTouches[0] : event;
          const target = document
            .elementFromPoint(point.clientX, point.clientY)
            ?.closest(".react-flow__node")
            ?.getAttribute("data-id");
          if (target && canLink(data.links, state.fromNode.id, target))
            onLink(state.fromNode.id, target);
        }}
        onInit={(instance) => {
          flow.current = instance;
        }}
        // Selection comes from the selected track, not from React Flow.
        onNodesChange={(changes: NodeChange<TrackFlowNode>[]) => {
          const rest = changes.filter((c) => c.type !== "select");
          if (rest.length > 0) setNodes((ns) => applyNodeChanges(rest, ns));
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--border)" gap={24} />
        <Controls showInteractive={false} />
        <MiniMap
          className="overflow-hidden rounded-md border border-border"
          maskColor="rgb(18 20 23 / 70%)"
          nodeColor={(n: TrackFlowNode) =>
            n.data.card.missing ? "var(--muted)" : "var(--primary)"
          }
          pannable
          zoomable
        />
      </ReactFlow>
      {menu && <ContextMenu items={menu.items} onClose={closeMenu} x={menu.x} y={menu.y} />}
    </div>
  );
}
