import "@xyflow/react/dist/style.css";
import { applyNodeChanges, Background, Controls, MarkerType, MiniMap, type NodeChange, ReactFlow } from "@xyflow/react";
import { type DragEvent, useCallback, useMemo, useRef, useState } from "react";
import type { ReactFlowInstance } from "@xyflow/react";
import type { BoardNode } from "../db/boards";
import { ContextMenu } from "@/components/ContextMenu";
import { buildGraph, canLink, edgeId } from "../domain/graph";
import { LinkEdge, type LinkFlowEdge } from "./LinkEdge";
import { TrackNode, type TrackFlowNode } from "./TrackNode";
import { TRACK_MIME, type TrackDrop } from "./dnd";
import type { MixmapData } from "./useMixmap";

const nodeTypes = { track: TrackNode };

const isTrackDrag = (e: DragEvent) => e.dataTransfer.types.includes(TRACK_MIME);

/** Accept only MixMap track drags (shows the "link" cursor). */
function onDragOver(e: DragEvent<HTMLDivElement>) {
  if (!isTrackDrag(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "link";
}

const edgeTypes = { link: LinkEdge };

type Props = {
  artworkVersion: number;
  data: MixmapData;
  nodes: BoardNode[];
  /** A table track was dropped on the canvas. */
  onDropTrack: (drop: TrackDrop) => void;
  /** Persist positions of nodes the user dragged. */
  onMoved: (positions: { trackKey: string; x: number; y: number }[]) => void;
  /** Remove a link (context menu "Remove"). */
  onDeleteLink: (from: string, to: string) => void;
  /** A connection was dragged from `source`'s right handle onto `target`. */
  onLink: (source: string, target: string) => void;
  /** Click on a link selects it; click on empty canvas clears the selection. */
  onSelectLink: (link: { from: string; to: string } | undefined) => void;
  selectedLink?: { from: string; to: string };
};

/** The active board's graph: track cards and directed links. Key it by board id. */
export function GraphCanvas({
  artworkVersion,
  data,
  nodes: boardNodes,
  onDeleteLink,
  onDropTrack,
  onLink,
  onMoved,
  onSelectLink,
  selectedLink,
}: Props) {
  const [menu, setMenu] = useState<{ from: string; to: string; x: number; y: number }>();
  const closeMenu = useCallback(() => setMenu(undefined), []);
  const flow = useRef<ReactFlowInstance<TrackFlowNode, LinkFlowEdge>>(null);
  const graph = useMemo(
    () => buildGraph(boardNodes, data.links, data.tracks, data.library),
    [boardNodes, data.links, data.tracks, data.library],
  );

  const fromGraph = useMemo<TrackFlowNode[]>(
    () =>
      graph.nodes.map((n) => ({
        data: { artworkVersion, card: n.card, highlighted: false },
        id: n.id,
        position: { x: n.x, y: n.y },
        type: "track",
      })),
    [graph.nodes, artworkVersion],
  );

  // The canvas owns positions once a node is shown (drags are saved from here, so a
  // reload racing a save must not snap nodes back). Reloads add/remove nodes, update
  // card data and keep selection; only new nodes take their stored position.
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
          ? { ...n, dragging: cur.dragging, measured: cur.measured, position: cur.position, selected: cur.selected }
          : n;
      }),
    );
  }

  const edges = useMemo<LinkFlowEdge[]>(
    () =>
      graph.edges.map((e) => ({
        data: { comment: e.comment, rating: e.rating, width: e.width },
        id: e.id,
        markerEnd: {
          color: "var(--muted-foreground)",
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
    [graph.edges, selectedLink],
  );

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
      positions: flow.current.getNodes().map((n) => ({ key: n.id, x: n.position.x, y: n.position.y })),
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
        // Fit once when a board opens (the canvas is keyed by board).
        fitView
        fitViewOptions={{ maxZoom: 1.2, padding: 0.2 }}
        // Links are drawn from a node's right handle; dragging the card only moves it.
        connectionRadius={40}
        // Deleting is handled by MixMap (links only, with undo), never by React Flow.
        deleteKeyCode={null}
        isValidConnection={(c) => canLink(data.links, c.source, c.target)}
        nodeTypes={nodeTypes}
        nodes={nodes}
        onNodeDragStop={(_e, _node, dragged) =>
          onMoved(dragged.map((n) => ({ trackKey: n.id, x: n.position.x, y: n.position.y })))
        }
        onConnect={(c) => onLink(c.source, c.target)}
        onEdgeClick={(_e, edge) => onSelectLink({ from: edge.source, to: edge.target })}
        onEdgeContextMenu={(e, edge) => {
          e.preventDefault();
          onSelectLink({ from: edge.source, to: edge.target });
          setMenu({ from: edge.source, to: edge.target, x: e.clientX, y: e.clientY });
        }}
        onPaneClick={() => onSelectLink(undefined)}
        // Dropped on a card but not near its handle: link to that card anyway.
        onConnectEnd={(event, state) => {
          if (state.isValid || !state.fromNode || state.fromHandle?.type !== "source") return;
          const point = "changedTouches" in event ? event.changedTouches[0] : event;
          const target = document
            .elementFromPoint(point.clientX, point.clientY)
            ?.closest(".react-flow__node")
            ?.getAttribute("data-id");
          if (target && canLink(data.links, state.fromNode.id, target)) onLink(state.fromNode.id, target);
        }}
        onInit={(instance) => {
          flow.current = instance;
        }}
        onNodesChange={(changes: NodeChange<TrackFlowNode>[]) => setNodes((ns) => applyNodeChanges(changes, ns))}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--border)" gap={24} />
        <Controls showInteractive={false} />
        <MiniMap
          maskColor="rgb(18 20 23 / 70%)"
          nodeColor={(n: TrackFlowNode) => (n.data.card.missing ? "var(--muted)" : "var(--primary)")}
          pannable
          zoomable
        />
      </ReactFlow>
      {menu && (
        <ContextMenu
          items={[{ destructive: true, label: "Remove link", onSelect: () => onDeleteLink(menu.from, menu.to) }]}
          onClose={closeMenu}
          x={menu.x}
          y={menu.y}
        />
      )}
    </div>
  );
}
