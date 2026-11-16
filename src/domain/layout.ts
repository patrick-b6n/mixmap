// Auto-layout of the graph: ELK "layered", left to right (A → B puts B right of A).
import ELK from "elkjs/lib/elk.bundled.js";
import { NODE_HEIGHT, NODE_WIDTH } from "./placement";

export type Position = { key: string; x: number; y: number };

const elk = new ELK();

/**
 * New top-left positions for `nodes`, laying out the links between them. Nodes
 * without links are laid out too (ELK packs disconnected clusters next to each
 * other). Links to tracks that aren't on the graph are ignored.
 */
export async function autoLayout(nodes: string[], links: { from: string; to: string }[]): Promise<Position[]> {
  if (nodes.length === 0) return [];
  const onGraph = new Set(nodes);
  const graph = await elk.layout({
    children: nodes.map((id) => ({ height: NODE_HEIGHT, id, width: NODE_WIDTH })),
    edges: links
      .filter((l) => onGraph.has(l.from) && onGraph.has(l.to) && l.from !== l.to)
      .map((l, i) => ({ id: `e${i}`, sources: [l.from], targets: [l.to] })),
    id: "graph",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.layered.spacing.nodeNodeBetweenLayers": "90",
      "elk.spacing.componentComponent": "60",
      "elk.spacing.nodeNode": "24",
    },
  });
  return (graph.children ?? []).map((c) => ({ key: c.id, x: c.x ?? 0, y: c.y ?? 0 }));
}
