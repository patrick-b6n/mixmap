import { Radio } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, type CalibrationRound, subscribe, type Track } from "../api";
import type { NowPlayingUpdate } from "../domain/nowPlaying";
import { TrackTypeahead } from "../library/TrackTypeahead";
import { errorText } from "./SyncSection";

type Props = { library: ReadonlyMap<string, Track> };

/** Settings → Now playing: what the memory reader sees, and its calibration. */
export function NowPlayingSection({ library }: Props) {
  const [update, setUpdate] = useState<NowPlayingUpdate>();
  const [wizard, setWizard] = useState(false);

  useEffect(() => {
    api.nowPlaying().then(
      (u) => u && setUpdate(u as NowPlayingUpdate),
      () => undefined,
    );
    return subscribe("now-playing", (u) => setUpdate(u as NowPlayingUpdate));
  }, []);

  return (
    <fieldset className="flex flex-col gap-1.5 rounded-sm border px-3 py-2.5">
      <legend className="px-1 text-muted-foreground">Now playing</legend>
      <div className="flex items-center gap-2">
        <Radio className="size-3.5 flex-none text-muted-foreground" />
        <span className="min-w-0 flex-1" data-testid="now-playing-status">
          {!update
            ? "Waiting for rekordbox…"
            : update.status === "unavailable"
              ? update.reason
              : update.decks.map((d) => `Deck ${d.deck}: ${d.title || "—"}`).join(" · ")}
        </span>
        <Button onClick={() => setWizard(true)}>Calibrate…</Button>
      </div>
      {wizard && <CalibrationDialog library={library} onClose={() => setWizard(false)} />}
    </fieldset>
  );
}

type Step =
  | { kind: "pick" }
  | { kind: "scanning"; phase: string; progress: number }
  | { kind: "result"; result: CalibrationRound }
  | { kind: "saved"; path: string };

/**
 * Calibration wizard: load tracks in rekordbox, tell MixMap which ones, repeat with
 * other tracks until each deck's title can be followed; then save.
 */
function CalibrationDialog({ library, onClose }: Props & { onClose: () => void }) {
  const tracks = useMemo(() => [...library.values()], [library]);
  const [deckCount, setDeckCount] = useState(2);
  const [chosen, setChosen] = useState<Record<number, string>>({});
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [last, setLast] = useState<CalibrationRound>();
  const [version, setVersion] = useState<string>();
  const [error, setError] = useState<string>();
  /** Titles used in earlier rounds, per deck: the next round needs other tracks. */
  const [used, setUsed] = useState<Record<number, string[]>>({});

  useEffect(
    () =>
      subscribe("calibration-progress", (p) => {
        const { done, phase, total } = p as { done: number; phase: string; total: number };
        setStep((s) => (s.kind === "scanning" ? { kind: "scanning", phase, progress: total ? done / total : 0 } : s));
      }),
    [],
  );

  const decks = Array.from({ length: deckCount }, (_, i) => i + 1);
  const picked = decks.map((d) => library.get(chosen[d] ?? ""));
  const titles = picked.map((t) => t?.title.trim() ?? "");
  const repeated = decks.some((d, i) => used[d]?.includes(titles[i]));
  const complete = picked.every(Boolean) && new Set(titles).size === titles.length && !repeated;

  const close = () => {
    if (step.kind !== "saved") void api.calibrationCancel().catch(() => undefined);
    onClose();
  };

  const scan = async () => {
    setError(undefined);
    setStep({ kind: "scanning", phase: "Starting", progress: 0 });
    try {
      if (!last) setVersion((await api.calibrationStart()).version);
      const result = await api.calibrationRound(
        decks.map((d, i) => ({ artist: picked[i]!.artist, deck: d, title: picked[i]!.title })),
      );
      setUsed((u) => Object.fromEntries(decks.map((d, i) => [d, [...(u[d] ?? []), titles[i]]])));
      setLast(result);
      setChosen({});
      setStep({ kind: "result", result });
    } catch (e) {
      setError(errorText(e));
      setStep(last ? { kind: "result", result: last } : { kind: "pick" });
    }
  };

  const restart = () => {
    void api.calibrationCancel().catch(() => undefined);
    setLast(undefined);
    setUsed({});
    setChosen({});
    setError(undefined);
    setStep({ kind: "pick" });
  };

  const save = async () => {
    setError(undefined);
    try {
      setStep({ kind: "saved", path: (await api.calibrationSave()).path });
    } catch (e) {
      setError(errorText(e));
    }
  };

  const lost = last?.decks.filter((d) => d.title === 0).map((d) => d.deck) ?? [];
  const picking = step.kind === "pick" || (step.kind === "result" && lost.length === 0);

  return (
    <Dialog onOpenChange={(open) => !open && close()} open>
      <DialogContent
        className="flex max-h-[85vh] flex-col gap-3 rounded-md bg-card p-5 sm:max-w-180"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle className="text-base">Calibrate now-playing detection</DialogTitle>
          <DialogDescription>
            MixMap learns where rekordbox{version ? ` ${version}` : ""} keeps the loaded tracks (read-only, nothing in
            rekordbox is changed). Needed once per rekordbox version.
          </DialogDescription>
        </DialogHeader>

        {step.kind === "saved" ? (
          <div data-testid="calibration-saved">
            Saved. The overlay now follows your decks automatically.
            <div className="text-xs [overflow-wrap:anywhere] text-muted-foreground">{step.path}</div>
          </div>
        ) : step.kind === "scanning" ? (
          <div className="flex flex-col gap-1" data-testid="calibration-scanning">
            <div>{step.phase}…</div>
            <div className="h-1.5 rounded-full bg-muted">
              <div className="h-1.5 rounded-full bg-primary" style={{ width: `${Math.round(step.progress * 100)}%` }} />
            </div>
            <div className="text-xs text-muted-foreground">
              The first round reads rekordbox's memory; this can take a minute.
            </div>
          </div>
        ) : (
          <>
            <ol className="list-decimal pl-5 text-[13px]">
              {!last ? (
                <>
                  <li>Open rekordbox and load a different track on each deck (they may be paused).</li>
                  <li>Pick the same tracks here, then press Scan.</li>
                </>
              ) : lost.length > 0 ? (
                <li>
                  Couldn't follow deck {lost.join(", ")}. Check that the picked tracks were really loaded, then start
                  over.
                </li>
              ) : (
                <>
                  <li>
                    Round {last.rounds} done.{" "}
                    {last.ready
                      ? "You can save now; another round makes it more reliable."
                      : "Now load other tracks on each deck."}
                  </li>
                  <li>Pick them here and press Check.</li>
                </>
              )}
            </ol>
            {last && (
              <div className="text-xs text-muted-foreground" data-testid="calibration-counts">
                {last.decks
                  .map(
                    (d) =>
                      `Deck ${d.deck}: ${d.title} title / ${d.artist} artist candidate${d.artist === 1 ? "" : "s"}`,
                  )
                  .join(" · ")}
              </div>
            )}
            {picking && (
              <>
                {!last && (
                  <label className="flex items-center gap-2 text-[13px]">
                    Decks:
                    <select
                      className="h-6 rounded-sm border border-input bg-input/30 px-1"
                      onChange={(e) => setDeckCount(Number(e.target.value))}
                      value={deckCount}
                    >
                      <option value={2}>2</option>
                      <option value={4}>4</option>
                    </select>
                  </label>
                )}
                <div className="grid min-h-0 grid-cols-2 gap-2 overflow-y-auto">
                  {decks.map((d, i) => (
                    <div className="flex min-h-0 flex-col rounded-sm border" data-calibration-deck={d} key={d}>
                      <div className="flex items-center gap-1 border-b px-2 py-0.5 text-xs">
                        <span className="font-semibold">Deck {d}</span>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">
                          {picked[i] ? `${picked[i]!.artist} – ${picked[i]!.title}` : "not picked"}
                        </span>
                        {used[d]?.includes(titles[i]) && <span className="text-destructive">used before</span>}
                      </div>
                      <div className="h-40">
                        <TrackTypeahead
                          autoFocus={false}
                          library={tracks}
                          onPick={(id) => setChosen((c) => ({ ...c, [d]: id }))}
                          suggestions={[]}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
        {error && (
          <div className="text-destructive" role="alert">
            {error}
          </div>
        )}
        <DialogFooter>
          {step.kind === "saved" ? (
            <Button onClick={onClose} variant="default">
              Done
            </Button>
          ) : (
            <>
              {last && <Button onClick={restart}>Start over</Button>}
              {last?.ready && lost.length === 0 && (
                <Button disabled={step.kind === "scanning"} onClick={() => void save()} variant="default">
                  Save
                </Button>
              )}
              {lost.length === 0 && (
                <Button
                  disabled={!complete || step.kind === "scanning"}
                  onClick={() => void scan()}
                  variant={last?.ready ? "subtle" : "default"}
                >
                  {last ? "Check" : "Scan"}
                </Button>
              )}
              <Button disabled={step.kind === "scanning"} onClick={close}>
                Cancel
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
