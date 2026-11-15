import { Crown, MessageSquare, Pencil, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Placeholder } from "@/components/Placeholder";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Track } from "../api";
import {
  buildIndex,
  combine,
  type DeckState,
  type ManualState,
  type NowPlayingState,
  shownDecks,
} from "../domain/nowPlaying";
import { type OverlayLink, outgoingLinks } from "../domain/overlay";
import { formatBpm, keyLabel, stars } from "../domain/trackTable";
import { useMixmap, type MixmapData } from "../graph/useMixmap";
import { Artwork } from "../library/TrackTable";
import { TrackTypeahead } from "../library/TrackTypeahead";
import { useLibrary } from "../library/useLibrary";
import { inTauri } from "../api";
import { loadOpacity, OPACITY_KEY } from "../desktop/overlayWindow";
import { OverlayBar } from "./OverlayBar";
import { useNowPlaying } from "./useNowPlaying";

/**
 * Live overlay: one column per deck with the loaded track and where you can go from
 * it (its outgoing links). Read-only apart from manual mode, which sets what a deck
 * plays when automatic detection can't (or gets it wrong).
 */
export function Overlay() {
  const { error, library } = useLibrary();
  const mixmap = useMixmap(library);
  const { auto, manual, setManual } = useNowPlaying();
  const index = useMemo(() => buildIndex(library?.tracks ?? []), [library]);
  const state = useMemo(
    () => combine(auto, manual, index, mixmap.library, (t) => mixmap.linkCountById(t.id) > 0),
    [auto, manual, index, mixmap],
  );
  const version = library?.version ?? 0;
  const [extraDecks, setExtraDecks] = useState<number[]>([]);
  const [opacity, setOpacity] = useState(loadOpacity);
  const desktop = inTauri();

  // Opacity changed in another window (or by the slider here).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => e.key === OPACITY_KEY && setOpacity(loadOpacity());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  if (!library) return <Placeholder className="p-3">{error ?? "Loading…"}</Placeholder>;
  const decks = [...new Set([...shownDecks(state), ...extraDecks])].toSorted((a, b) => a - b);

  const setDeck = (deck: number, trackId: string | undefined) =>
    setManual({ ...manual, decks: { ...manual.decks, [deck]: trackId } });
  /** Back to the automatic source for this deck (or empty without one). */
  const clearDeck = (deck: number) => {
    const { [deck]: _gone, ...rest } = manual.decks;
    setManual({ ...manual, decks: rest, master: manual.master === deck ? undefined : manual.master });
  };
  const toggleMaster = (deck: number) =>
    setManual({ ...manual, master: manual.master === deck ? undefined : deck } satisfies ManualState);

  return (
    <div
      className={cn("flex h-full flex-col", desktop && "overflow-hidden rounded-md border bg-background")}
      style={desktop ? { opacity } : undefined}
    >
      {desktop && <OverlayBar onOpacity={setOpacity} opacity={opacity} />}
      <div
        className="flex items-center gap-1.5 px-2 pt-1 text-[11px] text-muted-foreground"
        data-testid="overlay-source"
      >
        <span className="min-w-0 flex-1 truncate">
          {auto?.status === "ok"
            ? `Automatic: ${auto.source}`
            : auto?.status === "unavailable"
              ? `Automatic detection off: ${auto.reason}`
              : "Automatic detection isn't available yet: set tracks manually"}
        </span>
        <Button
          aria-label="Add deck"
          onClick={() => setExtraDecks((d) => [...d, Math.max(...decks) + 1])}
          size="icon-compact"
          title="Add a deck"
          variant="ghost"
        >
          <Plus />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 gap-1.5 p-1.5">
        {decks.map((n) => (
          <DeckColumn
            data={mixmap}
            deck={state.decks.find((d) => d.deck === n) ?? { deck: n, manual: false, resolution: { kind: "empty" } }}
            key={n}
            library={library.tracks}
            master={state.master === n}
            onClear={() => clearDeck(n)}
            onMaster={() => toggleMaster(n)}
            onSet={(id) => setDeck(n, id)}
            state={state}
            version={version}
          />
        ))}
      </div>
    </div>
  );
}

type DeckProps = {
  data: MixmapData;
  deck: DeckState;
  library: Track[];
  master: boolean;
  onClear: () => void;
  onMaster: () => void;
  onSet: (trackId: string) => void;
  state: NowPlayingState;
  version: number;
};

function DeckColumn({ data, deck, library, master, onClear, onMaster, onSet, state, version }: DeckProps) {
  const r = deck.resolution;
  const track = r.kind === "matched" ? r.track : undefined;
  const [picking, setPicking] = useState(false);
  const links = useMemo(
    () => (track ? outgoingLinks(track, deck.deck, data.links, data.tracks, data.library, state) : []),
    [track, deck.deck, data, state],
  );
  // Likely next tracks: where the other decks' tracks link to.
  const suggestions = useMemo(() => {
    const out: Track[] = [];
    for (const d of state.decks) {
      if (d.deck === deck.deck || d.resolution.kind !== "matched") continue;
      for (const l of outgoingLinks(d.resolution.track, d.deck, data.links, data.tracks, data.library, state)) {
        if (l.target && !out.includes(l.target)) out.push(l.target);
      }
    }
    return out;
  }, [state, deck.deck, data]);
  const choosing = picking || r.kind === "empty" || r.kind === "ambiguous" || r.kind === "unknown";

  return (
    <section
      aria-label={`Deck ${deck.deck}`}
      className={cn(
        "flex min-w-0 flex-1 flex-col rounded-md border bg-card/90",
        master && "border-primary ring-1 ring-primary",
      )}
      data-deck={deck.deck}
    >
      <header className="flex items-center gap-1 border-b px-2 py-0.5 text-xs text-muted-foreground">
        <span className="font-semibold">Deck {deck.deck}</span>
        {master && (
          <span className="rounded-sm bg-primary px-1 text-[10px] font-bold text-primary-foreground">MASTER</span>
        )}
        {deck.manual && <span title="Set manually">manual</span>}
        <span className="flex-1" />
        <Button
          aria-label={master ? "Unset master" : "Make master"}
          aria-pressed={master}
          onClick={onMaster}
          size="icon-compact"
          title={master ? "Unset master" : "Make this the master deck"}
          variant="ghost"
        >
          <Crown className="size-3.5" />
        </Button>
        {track && (
          <Button
            aria-label="Change track"
            onClick={() => setPicking((p) => !p)}
            size="icon-compact"
            title="Set the track manually"
            variant="ghost"
          >
            <Pencil className="size-3.5" />
          </Button>
        )}
        {deck.manual && (
          <Button
            aria-label="Clear deck"
            onClick={onClear}
            size="icon-compact"
            title="Clear the manual track (back to automatic detection)"
            variant="ghost"
          >
            <X className="size-3.5" />
          </Button>
        )}
      </header>
      {track && (
        <div className="flex items-center gap-2 border-b p-2">
          <Artwork trackId={track.id} version={version} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{track.title}</div>
            <div className="truncate text-xs text-muted-foreground">
              {track.artist}
              {track.bpm > 0 && ` · ${formatBpm(track.bpm)}`}
              {track.key && ` · ${keyLabel(track.key)}`}
            </div>
          </div>
        </div>
      )}
      {!track && r.kind !== "empty" && (
        <div className="border-b px-2 py-1 text-xs text-muted-foreground">
          {r.kind === "unknown" && `“${r.artist} – ${r.title}” isn't in the library`}
          {r.kind === "ambiguous" && `${r.candidates.length} tracks match “${r.candidates[0].title}”: pick one`}
        </div>
      )}
      {choosing && (
        <TrackTypeahead
          autoFocus={picking}
          candidates={r.kind === "ambiguous" ? r.candidates : undefined}
          library={library}
          onPick={(id) => {
            setPicking(false);
            onSet(id);
          }}
          suggestions={suggestions}
        />
      )}
      {!choosing && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {links.length === 0 && <div className="p-2 text-xs text-muted-foreground">No links from this track.</div>}
          <ul aria-label="Mixes into">
            {links.map((l) => (
              <LinkRow key={l.targetKey} link={l} />
            ))}
          </ul>
        </div>
      )}
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
