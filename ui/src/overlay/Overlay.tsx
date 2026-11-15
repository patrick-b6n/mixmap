import { MessageSquare } from "lucide-react";
import { useMemo, useState } from "react";
import { Placeholder } from "@/components/Placeholder";
import { cn } from "@/lib/utils";
import type { Track } from "../api";
import { buildIndex, combine, type DeckState, type NowPlayingState } from "../domain/nowPlaying";
import { type OverlayLink, outgoingLinks } from "../domain/overlay";
import { formatBpm, keyLabel, stars } from "../domain/trackTable";
import { useMixmap, type MixmapData } from "../graph/useMixmap";
import { Artwork } from "../library/TrackTable";
import { useLibrary } from "../library/useLibrary";
import { useNowPlaying } from "./useNowPlaying";

/**
 * Live overlay: one column per deck with the loaded track and where you can go from
 * it (its outgoing links). Read-only.
 */
export function Overlay() {
  const { error, library } = useLibrary();
  const mixmap = useMixmap(library);
  const { auto, manual } = useNowPlaying();
  const index = useMemo(() => buildIndex(library?.tracks ?? []), [library]);
  const state = useMemo(
    () => combine(auto, manual, index, mixmap.library, (t) => mixmap.linkCountById(t.id) > 0),
    [auto, manual, index, mixmap],
  );
  const version = library?.version ?? 0;

  if (!library) return <Placeholder className="p-3">{error ?? "Loading…"}</Placeholder>;
  return (
    <div className="flex h-full flex-col">
      {state.decks.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 p-3 text-center text-muted-foreground">
          <span>Nothing loaded.</span>
          <span className="text-xs" data-testid="overlay-source">
            {auto?.status === "unavailable"
              ? `Automatic detection: ${auto.reason}`
              : "Automatic detection isn't available yet."}{" "}
            Set tracks manually.
          </span>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-1.5 p-1.5">
          {state.decks.map((d) => (
            <DeckColumn
              data={mixmap}
              deck={d}
              key={d.deck}
              master={state.master === d.deck}
              state={state}
              version={version}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DeckColumn({
  data,
  deck,
  master,
  state,
  version,
}: {
  data: MixmapData;
  deck: DeckState;
  master: boolean;
  state: NowPlayingState;
  version: number;
}) {
  const r = deck.resolution;
  const track = r.kind === "matched" ? r.track : undefined;
  const links = useMemo(
    () => (track ? outgoingLinks(track, deck.deck, data.links, data.tracks, data.library, state) : []),
    [track, deck.deck, data, state],
  );
  return (
    <section
      aria-label={`Deck ${deck.deck}`}
      className={cn(
        "flex min-w-0 flex-1 flex-col rounded-md border bg-card/90",
        master && "border-primary ring-1 ring-primary",
      )}
      data-deck={deck.deck}
    >
      <header className="flex items-center gap-1.5 border-b px-2 py-1 text-xs text-muted-foreground">
        <span className="font-semibold">Deck {deck.deck}</span>
        {master && (
          <span className="rounded-sm bg-primary px-1 text-[10px] font-bold text-primary-foreground">MASTER</span>
        )}
        {deck.manual && <span title="Set manually">manual</span>}
      </header>
      <div className="flex items-center gap-2 border-b p-2">
        {track ? (
          <>
            <Artwork trackId={track.id} version={version} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{track.title}</div>
              <div className="truncate text-xs text-muted-foreground">
                {track.artist}
                {track.bpm > 0 && ` · ${formatBpm(track.bpm)}`}
                {track.key && ` · ${keyLabel(track.key)}`}
              </div>
            </div>
          </>
        ) : (
          <div className="text-xs text-muted-foreground">
            {r.kind === "empty" && "Empty"}
            {r.kind === "unknown" && `“${r.artist} – ${r.title}” isn't in the library`}
            {r.kind === "ambiguous" &&
              `${r.candidates.length} tracks match “${r.candidates[0].title}”: set it manually`}
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {track && links.length === 0 && (
          <div className="p-2 text-xs text-muted-foreground">No links from this track.</div>
        )}
        <ul aria-label="Mixes into">
          {links.map((l) => (
            <LinkRow key={l.targetKey} link={l} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function LinkRow({ link }: { link: OverlayLink }) {
  const [open, setOpen] = useState(false);
  const t: Track | undefined = link.target;
  return (
    <li className="border-b last:border-0">
      <button
        aria-expanded={link.comment ? open : undefined}
        className={cn("flex w-full flex-col px-2 py-1 text-left", link.comment && "hover:bg-accent/40")}
        onClick={() => link.comment && setOpen((o) => !o)}
        type="button"
      >
        <div className="flex items-center gap-1">
          <span className={cn("min-w-0 flex-1 truncate", !t && "text-muted-foreground italic")}>
            {link.targetTitle}
          </span>
          {link.comment && <MessageSquare className="size-3 flex-none text-muted-foreground" />}
          {link.rating !== null && <span className="flex-none text-[11px] text-primary">{stars(link.rating)}</span>}
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">{link.targetArtist}</span>
          {t && t.bpm > 0 && <span className="tabular-nums">{formatBpm(t.bpm)}</span>}
          {t?.key && <span>{keyLabel(t.key)}</span>}
          {!t && <span>missing</span>}
          {link.loadedOn.length > 0 && (
            <span className="rounded-sm bg-accent px-1 text-accent-foreground" data-testid="loaded-on">
              on deck {link.loadedOn.join(", ")}
            </span>
          )}
        </div>
        {open && <div className="pt-0.5 text-xs whitespace-pre-wrap">{link.comment}</div>}
      </button>
    </li>
  );
}
