import { BaseEdge, type Edge, EdgeLabelRenderer, type EdgeProps, getBezierPath } from "@xyflow/react";
import { MessageSquare } from "lucide-react";

export type LinkEdgeData = { comment: string; dimmed?: boolean; rating: number | null; width: number };
export type LinkFlowEdge = Edge<LinkEdgeData, "link">;

/** Directed link: arrow, thickness by rating, comment icon in the middle. */
export function LinkEdge(props: EdgeProps<LinkFlowEdge>) {
  const { data, markerEnd, selected } = props;
  const [path, labelX, labelY] = getBezierPath(props);
  return (
    <>
      <BaseEdge
        interactionWidth={16}
        markerEnd={markerEnd}
        path={path}
        style={{
          opacity: data?.dimmed && !selected ? 0.15 : 1,
          stroke: selected ? "var(--primary)" : "var(--muted-foreground)",
          strokeWidth: data?.width ?? 1.5,
        }}
      />
      {data?.comment && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-auto absolute rounded-sm border bg-card p-0.5 text-muted-foreground"
            style={{
              opacity: data.dimmed && !selected ? 0.15 : 1,
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
            title={data.comment}
          >
            <MessageSquare className="size-3" />
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
