import "@xyflow/react/dist/style.css";
import { applyNodeChanges, Background, Controls, MarkerType, MiniMap, type NodeChange, ReactFlow } from "@xyflow/react";
import { useMemo, useState } from "react";
import type { BoardNode } from "../db/boards";
import { buildGraph } from "../domain/graph";
import { LinkEdge, type LinkFlowEdge } from "./LinkEdge";
import { TrackNode, type TrackFlowNode } from "./TrackNode";
import type { MixmapData } from "./useMixmap";

const nodeTypes = { track: TrackNode };
const edgeTypes = { link: LinkEdge };

type Props = {
  artworkVersion: number;
  data: MixmapData;
  nodes: BoardNode[];
  /** Persist positions of nodes the user dragged. */
  onMoved: (positions: { trackKey: string; x: number; y: number }[]) => void;
};

/** The active board's graph: track cards and directed links. Key it by board id. */
export function GraphCanvas({ artworkVersion, data, nodes: boardNodes, onMoved }: Props) {
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
        return cur ? { ...n, dragging: cur.dragging, position: cur.position, selected: cur.selected } : n;
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
        source: e.from,
        target: e.to,
        type: "link",
      })),
    [graph.edges],
  );

  return (
    <ReactFlow<TrackFlowNode, LinkFlowEdge>
      colorMode="dark"
      edgeTypes={edgeTypes}
      edges={edges}
      // Fit once when a board opens (the canvas is keyed by board).
      fitView
      fitViewOptions={{ maxZoom: 1.2, padding: 0.2 }}
      // Dragging an existing node only moves it; links come from handles (#21).
      nodesConnectable={false}
      nodeTypes={nodeTypes}
      nodes={nodes}
      onNodeDragStop={(_e, _node, dragged) =>
        onMoved(dragged.map((n) => ({ trackKey: n.id, x: n.position.x, y: n.position.y })))
      }
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
  );
}
