import type { ReactNode } from "react";
import { cn } from "@/ui/lib/utils";
import { formatBpm, keyLabel } from "@/business/trackTable";
import type { NodeCard } from "@/business/graph";
import { Artwork } from "@/ui/library/Artwork";

/**
 * Look of a track card on the graph: artwork, title, artist, BPM, key, link count.
 * Missing tracks are dashed. Used by graph nodes and as the table's drag image.
 */
export function TrackCard({
  artworkVersion,
  card,
  children,
  className,
  eager,
}: {
  artworkVersion: number;
  card: Omit<NodeCard, "key">;
  /** Extra content inside the card (the node's handles). */
  children?: ReactNode;
  className?: string;
  /** Load the artwork right away (off-screen drag image). */
  eager?: boolean;
}) {
  const t = card.track;
  return (
    <div
      className={cn(
        "flex w-52 items-center gap-2 rounded-md border bg-card p-1.5 text-[12px] shadow-sm",
        card.missing && "border-dashed opacity-60",
        className,
      )}
      title={
        card.missing
          ? `${card.artist} – ${card.title} (missing in rekordbox)`
          : `${card.artist} – ${card.title}`
      }
    >
      {t ? (
        <Artwork eager={eager} trackId={t.id} version={artworkVersion} />
      ) : (
        <div className="flex size-6 flex-none items-center justify-center rounded-[3px] bg-muted text-[10px]">
          ?
        </div>
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
      {children}
    </div>
  );
}
