import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { api, type LibrarySource, type LibraryStatus, type Track } from "../api";
import { apiDb } from "../db/db";
import { setSetting, SETTINGS } from "../db/settings";
import { DataSection } from "./DataSection";
import { SyncSection } from "./SyncSection";

type Props = {
  /** rekordbox tracks by id (to describe manual matches portably in exports). */
  library: ReadonlyMap<string, Track>;
  onClose: () => void;
  /** MixMap data changed (import, reset): re-run matching and reload. */
  onDataChanged: () => void;
  status?: LibraryStatus;
};

type Kind = LibrarySource["kind"];

const KINDS: { kind: Kind; label: string }[] = [
  { kind: "auto", label: "Automatic (rekordbox's own master.db)" },
  { kind: "masterDb", label: "Specific master.db" },
  { kind: "xml", label: "rekordbox XML export (File → Export Collection in xml format)" },
];

/** Settings: where the rekordbox library comes from. */
export function SettingsDialog({ library, onClose, onDataChanged, status }: Props) {
  const current = status?.source ?? { kind: "auto" };
  const [kind, setKindState] = useState<Kind>(current.kind);
  const [path, setPath] = useState(current.kind === "auto" ? "" : current.path);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>();
  /** A path only makes sense for its kind: switching clears it. */
  const setKind = (k: Kind) => {
    setKindState(k);
    setPath(current.kind === k && current.kind !== "auto" ? current.path : "");
    setResult(undefined);
  };

  const apply = async () => {
    const source: LibrarySource = kind === "auto" ? { kind } : { kind, path: path.trim() };
    if (source.kind !== "auto" && !source.path) {
      setResult("Enter a path.");
      return;
    }
    setBusy(true);
    setResult(undefined);
    try {
      const s = await api.setLibrarySource(source);
      if (s.error) {
        setResult(`Error: ${s.error}`);
      } else {
        // Only a source that loaded is remembered for the next start.
        await setSetting(apiDb, SETTINGS.librarySource, source);
        setResult(`Loaded ${s.trackCount} tracks, ${s.playlistCount} playlists.`);
      }
    } catch (e) {
      setResult(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog defaultOpen onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-3 rounded-md bg-card p-5 sm:max-w-140" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-base">Settings</DialogTitle>
          <DialogDescription className="sr-only">Choose where the rekordbox library comes from.</DialogDescription>
        </DialogHeader>
        <fieldset className="flex flex-col gap-1.5 rounded-sm border px-3 py-2.5">
          <legend className="px-1 text-muted-foreground">rekordbox library</legend>
          <RadioGroup className="gap-1.5" onValueChange={(v) => setKind(v as Kind)} value={kind}>
            {KINDS.map((k) => (
              <div className="flex items-center gap-2" key={k.kind}>
                <RadioGroupItem id={`source-${k.kind}`} value={k.kind} />
                <Label className="text-[13px] font-normal" htmlFor={`source-${k.kind}`}>
                  {k.label}
                </Label>
              </div>
            ))}
          </RadioGroup>
          {kind !== "auto" && (
            <Input
              aria-label="Path"
              className="mt-1"
              onChange={(e) => setPath(e.target.value)}
              placeholder={kind === "xml" ? "C:\\Users\\…\\rekordbox.xml" : "C:\\Users\\…\\master.db"}
              value={path}
            />
          )}
          {status?.location && (
            <div className="text-xs [overflow-wrap:anywhere] text-muted-foreground">
              Current: {status.location.dbPath}
            </div>
          )}
        </fieldset>
        {result && <div data-testid="settings-result">{result}</div>}
        <DataSection library={library} onDataChanged={onDataChanged} />
        <SyncSection />
        <DialogFooter>
          <Button disabled={busy} onClick={apply}>
            {busy ? "Loading…" : "Apply"}
          </Button>
          <DialogClose asChild>
            <Button>Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
