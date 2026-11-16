import { useMemo, useState } from "react";
import { Button } from "@/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/ui/dialog";
import { Input } from "@/ui/components/ui/input";
import { cn } from "@/ui/lib/utils";
import type { Track } from "@/business/model";
import { useAppServices } from "@/app/app-services";
import { type TrackRow } from "@/business/model";
import { rankCandidates } from "@/business/candidates";
import type { MatchResult } from "@/business/matching";
import { formatBpm, formatLength, keyLabel } from "@/business/trackTable";
import { m } from "@/paraglide/messages.js";

type Props = {
  library: Track[];
  onClose: () => void;
  /** A track was mapped: re-run matching and reload. */
  onMapped: () => void;
  results: MatchResult[];
  tracks: Map<string, TrackRow>;
};

type Item = {
  candidates?: string[];
  kind: "ambiguous" | "missing" | "unmatched";
  row?: TrackRow;
  trackKey: string;
};

const SECTIONS: { kind: Item["kind"]; label: () => string; hint: () => string }[] = [
  { hint: m.unmatched_unmatched_hint, kind: "unmatched", label: m.unmatched_unmatched },
  { hint: m.unmatched_ambiguous_hint, kind: "ambiguous", label: m.unmatched_ambiguous },
  { hint: m.unmatched_missing_hint, kind: "missing", label: m.unmatched_missing },
];

/** "Unmatched tracks": map mixmap tracks to rekordbox tracks by hand (remembered on this machine). */
export function UnmatchedDialog({ library, onClose, onMapped, results, tracks }: Props) {
  const { tracks: tracksRepository } = useAppServices();
  const items = useMemo(
    () =>
      results.flatMap((r): Item[] =>
        r.kind === "matched"
          ? []
          : [
              {
                candidates: r.kind === "ambiguous" ? r.candidates : undefined,
                kind: r.kind,
                row: tracks.get(r.trackKey),
                trackKey: r.trackKey,
              },
            ],
      ),
    [results, tracks],
  );
  const [selectedKey, setSelectedKey] = useState<string>();
  const selected = items.find((i) => i.trackKey === selectedKey) ?? items[0];
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const candidates = useMemo(() => {
    if (!selected) return [];
    const target = {
      artist: selected.row?.artist ?? "",
      duration: selected.row?.duration ?? 0,
      title: selected.row?.title ?? selected.trackKey,
    };
    const ranked = rankCandidates(target, library, query);
    // Ambiguous: the tracks that fit go first.
    if (!selected.candidates || query.trim()) return ranked;
    const fit = new Set(selected.candidates);
    const byId = new Map(library.map((t) => [t.id, t]));
    return [
      ...selected.candidates.flatMap((id) => byId.get(id) ?? []),
      ...ranked.filter((t) => !fit.has(t.id)),
    ];
  }, [selected, library, query]);

  const select = (key: string) => {
    setSelectedKey(key);
    setQuery("");
    setError(undefined);
  };

  const map = async (item: Item, track: Track) => {
    setBusy(true);
    setError(undefined);
    try {
      await tracksRepository.setManualMatch(item.trackKey, track.id);
      const next = items.find((i) => i.trackKey !== item.trackKey);
      if (next) select(next.trackKey);
      onMapped();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog defaultOpen onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex h-[70vh] flex-col gap-3 rounded-md bg-card p-5 sm:max-w-220"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle className="text-base">{m.unmatched_title()}</DialogTitle>
          <DialogDescription>{m.unmatched_description()}</DialogDescription>
        </DialogHeader>
        {items.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            {m.unmatched_all_matched()}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 gap-3">
            <ul
              aria-label={m.unmatched_list_label()}
              className="w-64 flex-none overflow-y-auto rounded-sm border"
            >
              {SECTIONS.map((s) => {
                const list = items.filter((i) => i.kind === s.kind);
                if (list.length === 0) return null;
                return (
                  <li key={s.kind}>
                    <div
                      className="sticky top-0 bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                      title={s.hint()}
                    >
                      {s.label()} ({list.length})
                    </div>
                    <ul>
                      {list.map((i) => (
                        <li key={i.trackKey}>
                          <button
                            aria-current={i === selected || undefined}
                            className={cn(
                              "w-full px-2 py-1 text-left hover:bg-accent/50",
                              i === selected && "bg-accent text-accent-foreground",
                            )}
                            onClick={() => select(i.trackKey)}
                            type="button"
                          >
                            <div className="truncate">{i.row?.title ?? i.trackKey}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {i.row?.artist}
                              {i.row && ` · ${formatLength(i.row.duration)}`}
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
            {selected && (
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div>
                  <div className="font-medium">
                    {selected.row
                      ? `${selected.row.artist} – ${selected.row.title}`
                      : selected.trackKey}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {SECTIONS.find((s) => s.kind === selected.kind)?.hint()}
                    {selected.row &&
                      ` ${m.unmatched_length({ length: formatLength(selected.row.duration) })}`}
                  </div>
                </div>
                <Input
                  aria-label={m.unmatched_search_label()}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={m.unmatched_search_placeholder()}
                  value={query}
                />
                <div className="min-h-0 flex-1 overflow-y-auto rounded-sm border">
                  {candidates.length === 0 ? (
                    <div className="p-3 text-muted-foreground">
                      {query.trim() ? m.unmatched_no_search_results() : m.unmatched_no_similar()}
                    </div>
                  ) : (
                    <table className="w-full text-[13px]">
                      <tbody>
                        {candidates.map((t) => (
                          <tr className="border-b last:border-0 hover:bg-accent/30" key={t.id}>
                            <td className="max-w-0 px-2 py-1">
                              <div className="truncate">{t.title}</div>
                              <div className="truncate text-xs text-muted-foreground">
                                {t.artist}
                                {t.album && ` · ${t.album}`}
                              </div>
                            </td>
                            <td className="w-14 px-1 text-right text-muted-foreground tabular-nums">
                              {formatLength(t.length)}
                            </td>
                            <td className="w-12 px-1 text-right text-muted-foreground tabular-nums">
                              {t.bpm > 0 ? formatBpm(t.bpm) : ""}
                            </td>
                            <td className="w-20 px-1 text-muted-foreground">
                              {t.key ? keyLabel(t.key) : ""}
                            </td>
                            <td className="w-16 px-2 text-right">
                              <Button disabled={busy} onClick={() => void map(selected, t)}>
                                {m.unmatched_map()}
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
                {error && (
                  <div className="text-destructive" role="alert">
                    {error}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <DialogClose render={<Button />}>{m.common_close()}</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
