import { ArrowRight } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { Playlist, Track } from "../api";
import { appDb } from "@/app/database";
import { createLinks, type Link } from "../db/links";
import { proposePairs } from "../domain/pairImport";

type Props = {
  library: ReadonlyMap<string, Track>;
  links: Pick<Link, "from" | "to">[];
  onClose: () => void;
  /** Links were created: reload. */
  onCreated: () => void;
  playlist: Playlist;
};

const label = (t: Track) => `${t.artist} – ${t.title}`;

const pairId = (p: { fromKey: string; toKey: string }) => `${p.fromKey}\u0001${p.toKey}`;

/** Preview of the back-to-back pairs of a playlist/history; nothing is saved until confirmed. */
export function PairImportDialog({ library, links, onClose, onCreated, playlist }: Props) {
  // Proposed once, when the dialog opens: the list doesn't jump while it's open.
  const [pairs] = useState(() => proposePairs(playlist.trackIds, library, links));
  const fresh = pairs.filter((p) => !p.exists);
  const [checked, setChecked] = useState(() => new Set(fresh.map(pairId)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const chosen = useMemo(() => fresh.filter((p) => checked.has(pairId(p))), [fresh, checked]);

  const toggle = (id: string, on: boolean) =>
    setChecked((c) => {
      const next = new Set(c);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const create = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await createLinks(
        appDb,
        chosen.map((p) => ({ from: p.from, to: p.to })),
      );
      onCreated();
      toast(`Created ${chosen.length} link${chosen.length === 1 ? "" : "s"} from “${playlist.name}”`);
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <Dialog defaultOpen onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex max-h-[80vh] flex-col gap-3 rounded-md bg-card p-5 sm:max-w-200"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle className="text-base">Import pairs from “{playlist.name}”</DialogTitle>
          <DialogDescription>
            Each track followed by the next becomes a link. {pairs.length} pair{pairs.length === 1 ? "" : "s"}
            {pairs.length - fresh.length > 0 && `, ${pairs.length - fresh.length} already linked`}.
          </DialogDescription>
        </DialogHeader>
        {pairs.length === 0 ? (
          <div className="py-6 text-center text-muted-foreground">No back-to-back pairs in this list.</div>
        ) : (
          <>
            {fresh.length > 0 && (
              <div className="flex gap-2">
                <Button onClick={() => setChecked(new Set(fresh.map(pairId)))}>Select all</Button>
                <Button onClick={() => setChecked(new Set())}>Select none</Button>
              </div>
            )}
            <ul aria-label="Proposed links" className="min-h-0 flex-1 overflow-y-auto rounded-sm border">
              {pairs.map((p) => {
                const id = pairId(p);
                return (
                  <li
                    className={cn("flex items-center gap-2 border-b px-2 py-1 last:border-0", p.exists && "opacity-60")}
                    key={id}
                  >
                    <Checkbox
                      aria-label={`${label(p.from)} to ${label(p.to)}`}
                      checked={p.exists || checked.has(id)}
                      disabled={p.exists}
                      onCheckedChange={(v) => toggle(id, v === true)}
                    />
                    <span className="min-w-0 flex-1 truncate" title={label(p.from)}>
                      {label(p.from)}
                    </span>
                    <ArrowRight className="size-3.5 flex-none text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate" title={label(p.to)}>
                      {label(p.to)}
                    </span>
                    <span className="w-6 flex-none text-xs text-muted-foreground" title="Times this transition occurs">
                      {p.occurrences > 1 && `×${p.occurrences}`}
                    </span>
                    <span className="w-12 flex-none text-right">
                      {p.exists && (
                        <span className="rounded-sm bg-muted px-1 text-xs text-muted-foreground">exists</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {error && (
          <div className="text-destructive" role="alert">
            {error}
          </div>
        )}
        <DialogFooter>
          <Button disabled={busy || chosen.length === 0} onClick={() => void create()} variant="default">
            {busy ? "Creating…" : `Create ${chosen.length} link${chosen.length === 1 ? "" : "s"}`}
          </Button>
          <DialogClose asChild>
            <Button>Cancel</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
