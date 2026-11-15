import { Placeholder } from "@/components/Placeholder";
import type { Track } from "../api";
import { formatBpm, formatLength, keyLabel, stars } from "../domain/trackTable";
import { Artwork } from "./TrackTable";

type Props = {
  track?: Track;
  version: number;
};

/** Right panel: large artwork, all metadata of the selected track, and its links. */
export function TrackDetails({ track, version }: Props) {
  if (!track) return <Placeholder>Select a track</Placeholder>;
  const fields: [string, string][] = [
    ["Artist", track.artist],
    ["Album", track.album],
    ["Genre", track.genre],
    ["BPM", formatBpm(track.bpm)],
    ["Key", keyLabel(track.key)],
    ["Rating", stars(track.rating)],
    ["Length", track.length > 0 ? formatLength(track.length) : ""],
    ["Comment", track.comment],
    ["File", track.filePath],
  ];
  return (
    <div className="flex flex-col gap-2.5 p-3">
      <Artwork key={track.id} size="large" trackId={track.id} version={version} />
      <h2 className="m-0 text-base font-semibold [overflow-wrap:anywhere]">{track.title || "Untitled"}</h2>
      <dl className="m-0 grid gap-1">
        {fields.map(([label, value]) => (
          <div className="grid grid-cols-[70px_1fr] gap-2" key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="m-0 [overflow-wrap:anywhere]" title={value}>
              {value || "–"}
            </dd>
          </div>
        ))}
      </dl>
      <section>
        <LinksHeading>Outgoing links</LinksHeading>
        <Placeholder className="px-0 py-1.5">No links yet</Placeholder>
        <LinksHeading>Incoming links</LinksHeading>
        <Placeholder className="px-0 py-1.5">No links yet</Placeholder>
      </section>
    </div>
  );
}

function LinksHeading({ children }: { children: string }) {
  return (
    <h3 className="mt-2 border-t pt-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
      {children}
    </h3>
  );
}
