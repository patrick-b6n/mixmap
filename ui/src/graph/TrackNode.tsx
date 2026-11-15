import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { memo } from "react";
import { cn } from "@/lib/utils";
import { formatBpm, keyLabel } from "../domain/trackTable";
import type { NodeCard } from "../domain/graph";
import { Artwork } from "../library/TrackTable";

export type TrackNodeData = { artworkVersion: number; card: NodeCard; highlighted: boolean };
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

/** Node card, re-rendered only when what it shows changes (large boards). */
export const TrackNode = memo(
  TrackNodeCard,
  (a, b) =>
    a.selected === b.selected &&
    a.data.highlighted === b.data.highlighted &&
    a.data.artworkVersion === b.data.artworkVersion &&
    sameCard(a.data.card, b.data.card),
);

/** Node card: artwork, title, artist, BPM, key, link count. Missing tracks are dashed. */
function TrackNodeCard({ data, selected }: NodeProps<TrackFlowNode>) {
  const { card } = data;
  const t = card.track;
  return (
    <div
      className={cn(
        "flex w-52 items-center gap-2 rounded-md border bg-card p-1.5 text-[12px] shadow-sm",
        card.missing && "border-dashed opacity-60",
        data.highlighted && "border-primary",
        selected && "border-primary ring-1 ring-primary",
      )}
      title={card.missing ? `${card.artist} – ${card.title} (missing in rekordbox)` : `${card.artist} – ${card.title}`}
    >
      {/* Incoming end only: links are always drawn from the right (source) handle. */}
      <Handle
        className="!size-2.5 !border-border !bg-muted"
        isConnectableStart={false}
        position={Position.Left}
        type="target"
      />
      {t ? (
        <Artwork trackId={t.id} version={data.artworkVersion} />
      ) : (
        <div className="flex size-6 flex-none items-center justify-center rounded-[3px] bg-muted text-[10px]">?</div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{card.title}</div>
        <div className="truncate text-muted-foreground">{card.artist}</div>
        <div className="flex gap-2 text-[11px] text-muted-foreground tabular-nums">
          {card.missing ? (
            <span>missing</span>
          ) : (
            <>
              {t && t.bpm > 0 && <span>{formatBpm(t.bpm)}</span>}
              {t?.key && <span>{keyLabel(t.key)}</span>}
            </>
          )}
        </div>
      </div>
      <span
        className="flex-none self-start rounded-sm bg-muted px-1 text-[10px] text-muted-foreground tabular-nums"
        title={`${card.linkCount} links`}
      >
        {card.linkCount}
      </span>
      {/* Drag from here to another card to link this track → that one. */}
      <Handle
        className="!size-3 !border-border !bg-muted hover:!border-primary hover:!bg-primary"
        position={Position.Right}
        title="Drag to another track to link"
        type="source"
      />
    </div>
  );
}
