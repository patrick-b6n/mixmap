import type { Track } from "../api";
import { formatBpm, formatLength, keyLabel, stars } from "../domain/trackTable";
import { Artwork } from "./TrackTable";

type Props = {
  track?: Track;
  version: number;
};

/** Right panel: large artwork, all metadata of the selected track, and its links. */
export function TrackDetails({ track, version }: Props) {
  if (!track) return <div className="placeholder">Select a track</div>;
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
    <div className="details">
      <Artwork key={track.id} size="large" trackId={track.id} version={version} />
      <h2 className="details-title">{track.title || "Untitled"}</h2>
      <dl className="details-fields">
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd title={value}>{value || "–"}</dd>
          </div>
        ))}
      </dl>
      <section className="details-links">
        <h3>Outgoing links</h3>
        <div className="placeholder">No links yet</div>
        <h3>Incoming links</h3>
        <div className="placeholder">No links yet</div>
      </section>
    </div>
  );
}
