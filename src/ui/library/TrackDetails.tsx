import { Placeholder } from "@/ui/components/Placeholder";
import type { Track } from "@/business/model";
import { formatBpm, formatLength, keyLabel, stars } from "@/business/trackTable";
import { Artwork } from "./Artwork";
import { m } from "@/paraglide/messages.js";

/** A link as listed in the details panel. */
export type LinkItem = {
  comment: string;
  from: string;
  label: string;
  rating: number | null;
  to: string;
};

type Props = {
  incoming: LinkItem[];
  onSelectLink: (link: { from: string; to: string }) => void;
  outgoing: LinkItem[];
  track?: Track;
  version: number;
};

/** Right panel: large artwork, all metadata of the selected track, and its links. */
export function TrackDetails({ incoming, onSelectLink, outgoing, track, version }: Props) {
  if (!track) return <Placeholder>{m.details_select_track()}</Placeholder>;
  const fields: [string, string][] = [
    [m.column_artist(), track.artist],
    [m.column_album(), track.album],
    [m.column_genre(), track.genre],
    [m.column_bpm(), formatBpm(track.bpm)],
    [m.column_key(), keyLabel(track.key)],
    [m.column_rating(), stars(track.rating)],
    [m.details_length(), track.length > 0 ? formatLength(track.length) : ""],
    [m.column_comment(), track.comment],
    [m.details_file(), track.filePath],
  ];
  return (
    <div className="flex flex-col gap-2.5 p-3">
      <Artwork key={track.id} size="large" trackId={track.id} version={version} />
      <h2 className="m-0 text-base font-semibold [overflow-wrap:anywhere]">
        {track.title || m.details_untitled()}
      </h2>
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
        <LinksHeading>{m.details_mixes_into({ count: outgoing.length })}</LinksHeading>
        <LinkList items={outgoing} onSelect={onSelectLink} />
        <LinksHeading>{m.details_comes_from({ count: incoming.length })}</LinksHeading>
        <LinkList items={incoming} onSelect={onSelectLink} />
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

/** Links of the selected track; click one to open it in the link editor. */
function LinkList({
  items,
  onSelect,
}: {
  items: LinkItem[];
  onSelect: (l: { from: string; to: string }) => void;
}) {
  if (items.length === 0)
    return <Placeholder className="px-0 py-1.5">{m.details_none_yet()}</Placeholder>;
  return (
    <ul className="mt-1 flex flex-col">
      {items.map((l) => (
        <li key={`${l.from}\u0001${l.to}`}>
          <button
            className="flex w-full flex-col rounded-sm px-1.5 py-1 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
            onClick={() => onSelect({ from: l.from, to: l.to })}
            title={l.comment || undefined}
          >
            <span className="flex w-full gap-2">
              <span className="min-w-0 flex-1 truncate">{l.label}</span>
              {l.rating !== null && <span className="text-rating">{"★".repeat(l.rating)}</span>}
            </span>
            {l.comment && (
              <span className="truncate text-[12px] text-muted-foreground">{l.comment}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
