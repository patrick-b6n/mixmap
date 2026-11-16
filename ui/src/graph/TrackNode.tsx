import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { memo } from "react";
import { cn } from "@/lib/utils";
import type { NodeCard } from "../domain/graph";
import { TrackCard } from "./TrackCard";

export type TrackNodeData = { artworkVersion: number; card: NodeCard; dimmed: boolean; highlighted: boolean };
export type TrackFlowNode = Node<TrackNodeData, "track">;

/** Same card content (cards are rebuilt on every reload, so compare by value). */
function sameCard(a: NodeCard, b: NodeCard): boolean {
  return (
    a.artist === b.artist &&
    a.linkCount === b.linkCount &&
    a.missing === b.missing &&
    a.title === b.title &&
    a.track?.id === b.track?.id &&
    a.track?.bpm === b.track?.bpm &&
    a.track?.key === b.track?.key
  );
}

/** Node card, re-rendered only when what it shows changes (large graphs). */
export const TrackNode = memo(
  TrackNodeCard,
  (a, b) =>
    a.selected === b.selected &&
    a.data.highlighted === b.data.highlighted &&
    a.data.dimmed === b.data.dimmed &&
    a.data.artworkVersion === b.data.artworkVersion &&
    sameCard(a.data.card, b.data.card),
);

/** Track card with its link handles and selection / filter states. */
function TrackNodeCard({ data, selected }: NodeProps<TrackFlowNode>) {
  return (
    <TrackCard
      artworkVersion={data.artworkVersion}
      card={data.card}
      className={cn(
        // Filtered out: stays in place but recedes (selected/highlighted cards stay readable).
        data.dimmed && !selected && !data.highlighted && "opacity-25",
        data.highlighted && "border-primary",
        selected && "border-primary ring-1 ring-primary",
      )}
    >
      {/* Incoming end only: links are always drawn from the right (source) handle. */}
      <Handle
        className="!size-2.5 !border-border !bg-muted"
        isConnectableStart={false}
        position={Position.Left}
        type="target"
      />
      {/* Drag from here to another card to link this track → that one. */}
      <Handle
        className="!size-3 !border-border !bg-muted hover:!border-primary hover:!bg-primary"
        position={Position.Right}
        title="Drag to another track to link"
        type="source"
      />
    </TrackCard>
  );
}
