import { Music } from "lucide-react";
import { useState } from "react";
import { cn } from "@/ui/lib/utils";
import { artworkUrl } from "@/app/backend";

/** Artwork URLs known to have no image, so remounted rows don't ask again. */
const missingArtwork = new Set<string>();

/** Thumbnail with a placeholder when the track has no artwork. */
export function Artwork({
  eager = false,
  size = "small",
  trackId,
  version,
}: {
  /** Load right away even off-screen (e.g. a drag image). */
  eager?: boolean;
  size?: "large" | "small";
  trackId: string;
  version: number;
}) {
  const url = artworkUrl(trackId, size, version);
  const [failedUrl, setFailedUrl] = useState<string>();
  const missing = failedUrl === url || missingArtwork.has(url);
  const box = size === "small" ? "size-6" : "aspect-square w-full";
  if (missing)
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-[3px] bg-muted text-muted-foreground",
          box,
        )}
      >
        <Music className={size === "small" ? "size-3" : "size-16"} />
      </div>
    );
  return (
    <img
      alt=""
      className={cn("block rounded-[3px] object-cover", box)}
      loading={eager ? "eager" : "lazy"}
      onError={() => {
        missingArtwork.add(url);
        setFailedUrl(url);
      }}
      src={url}
    />
  );
}
