import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { Track } from "../api";
import { openTextFile, saveTextFile } from "../api/files";
import { writeBackup } from "../db/backup";
import { apiDb } from "../db/db";
import {
  exportData,
  exportFileName,
  type ImportMode,
  importData,
  type MixmapExport,
  parseExport,
  resetData,
  serializeExport,
} from "../db/exchange";
import type { Counts, MergeSummary } from "../domain/merge";

type Props = {
  library: ReadonlyMap<string, Track>;
  /** mixmap data changed (import): re-run matching and reload. */
  onDataChanged: () => void;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "3 added, 1 updated" (only non-zero parts), or undefined when nothing changed. */
function describe(c: Counts): string | undefined {
  const parts = [
    c.added && `${c.added} added`,
    c.updated && `${c.updated} updated`,
    c.deleted && `${c.deleted} deleted`,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}

export function summaryText(s: MergeSummary): string {
  const lines = (
    [
      ["Links", s.links],
      ["Graph tracks", s.nodes],
      ["Tracks", s.tracks],
      ["Manual matches", s.manualMatches],
    ] as const
  ).flatMap(([label, c]) => {
    const d = describe(c);
    return d ? [`${label}: ${d}`] : [];
  });
  return lines.length ? lines.join(" · ") : "Nothing changed: everything was already up to date.";
}

/** What to type to confirm a reset. */
const RESET_WORD = "RESET";

/** Settings → mixmap data: export, import (merge / replace), reset. */
export function DataSection({ library, onDataChanged }: Props) {
  const [message, setMessage] = useState<{ error?: boolean; text: string }>();
  const [pending, setPending] = useState<{ data: MixmapExport; name: string }>();
  const [mode, setMode] = useState<ImportMode>("merge");
  const [busy, setBusy] = useState(false);
  /** Typed confirmation while the reset panel is open; undefined = closed. */
  const [resetConfirm, setResetConfirm] = useState<string>();

  const runReset = async () => {
    setBusy(true);
    setMessage(undefined);
    try {
      const backup = await writeBackup(apiDb, library, "before-reset");
      await resetData(apiDb);
      setResetConfirm(undefined);
      onDataChanged();
      setMessage({ text: `mixmap data was reset. Backup: ${backup}` });
    } catch (e) {
      setMessage({ error: true, text: `Reset failed, nothing was deleted: ${String(e)}` });
    } finally {
      setBusy(false);
    }
  };

  const exportFile = async () => {
    setMessage(undefined);
    try {
      const data = await exportData(apiDb, library);
      saveTextFile(exportFileName(), serializeExport(data));
      setMessage({
        text: `Exported ${plural(data.links.length, "link")}, ${plural(data.nodes.length, "card")}, ${plural(
          data.tracks.length,
          "track",
        )}.`,
      });
    } catch (e) {
      setMessage({ error: true, text: `Export failed: ${String(e)}` });
    }
  };

  const chooseFile = async () => {
    setMessage(undefined);
    try {
      const file = await openTextFile(".json,application/json");
      if (!file) return;
      setResetConfirm(undefined);
      setPending({ data: parseExport(file.text), name: file.name });
      setMode("merge");
    } catch (e) {
      setPending(undefined);
      setMessage({ error: true, text: e instanceof Error ? e.message : String(e) });
    }
  };

  const runImport = async () => {
    if (!pending) return;
    setBusy(true);
    setMessage(undefined);
    try {
      let backup = "";
      if (mode === "replace") backup = await writeBackup(apiDb, library, "before-import");
      const summary = await importData(apiDb, pending.data, mode, library);
      setPending(undefined);
      onDataChanged();
      setMessage({
        text: `${summaryText(summary)}${backup ? ` Backup of the previous data: ${backup}` : ""}`,
      });
    } catch (e) {
      setMessage({ error: true, text: `Import failed, nothing was changed: ${String(e)}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <fieldset className="flex flex-col gap-1.5 rounded-sm border px-3 py-2.5">
      <legend className="px-1 text-muted-foreground">mixmap data</legend>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void exportFile()} title="Links, graph positions and manual matches">
          Export .mixmap.json
        </Button>
        <Button disabled={busy} onClick={() => void chooseFile()}>
          Import .mixmap.json…
        </Button>
        <Button
          className="ml-auto"
          disabled={busy}
          onClick={() => {
            setPending(undefined);
            setMessage(undefined);
            setResetConfirm("");
          }}
          variant="ghost"
        >
          Reset database…
        </Button>
      </div>
      {resetConfirm !== undefined && (
        <div className="flex flex-col gap-2 rounded-sm border border-destructive/60 p-2" data-testid="reset-panel">
          <div>
            Deletes all links, graph positions and manual matches. Your rekordbox library is not touched. A backup is
            saved first to <code>{"%APPDATA%\\mixmap\\backups"}</code>.
          </div>
          <label className="flex items-center gap-2">
            Type <code className="font-semibold">{RESET_WORD}</code> to confirm:
            <Input
              aria-label={`Type ${RESET_WORD} to confirm`}
              autoComplete="off"
              className="w-28"
              onChange={(e) => setResetConfirm(e.target.value)}
              value={resetConfirm}
            />
          </label>
          <div className="flex gap-2">
            <Button
              disabled={busy || resetConfirm !== RESET_WORD}
              onClick={() => void runReset()}
              variant="destructive"
            >
              {busy ? "Resetting…" : "Back up and reset"}
            </Button>
            <Button disabled={busy} onClick={() => setResetConfirm(undefined)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {pending && (
        <div className="flex flex-col gap-2 rounded-sm border border-dashed p-2" data-testid="import-preview">
          <div>
            <span className="font-medium [overflow-wrap:anywhere]">{pending.name}</span>
            <div className="text-xs text-muted-foreground">
              {plural(pending.data.links.length, "link")}, {plural(pending.data.nodes.length, "card")},{" "}
              {plural(pending.data.tracks.length, "track")}
              {pending.data.exportedAt > 0 && ` · exported ${new Date(pending.data.exportedAt).toLocaleString()}`}
            </div>
          </div>
          <RadioGroup className="gap-1.5" onValueChange={(v) => setMode(v as ImportMode)} value={mode}>
            <div className="flex items-start gap-2">
              <RadioGroupItem className="mt-0.5" id="import-merge" value="merge" />
              <Label className="flex-col items-start gap-0 text-[13px] font-normal" htmlFor="import-merge">
                Merge
                <span className="text-xs text-muted-foreground">
                  Keep what's here; for each link and position the newer version wins.
                </span>
              </Label>
            </div>
            <div className="flex items-start gap-2">
              <RadioGroupItem className="mt-0.5" id="import-replace" value="replace" />
              <Label className="flex-col items-start gap-0 text-[13px] font-normal" htmlFor="import-replace">
                Replace everything
                <span className="text-xs text-muted-foreground">
                  mixmap data here is replaced by the file. A backup is saved first.
                </span>
              </Label>
            </div>
          </RadioGroup>
          <div className="flex gap-2">
            <Button
              disabled={busy}
              onClick={() => void runImport()}
              variant={mode === "replace" ? "destructive" : "default"}
            >
              {busy ? "Importing…" : mode === "replace" ? "Back up and replace" : "Merge"}
            </Button>
            <Button disabled={busy} onClick={() => setPending(undefined)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {message && (
        <div
          className={message.error ? "text-destructive [overflow-wrap:anywhere]" : "[overflow-wrap:anywhere]"}
          data-testid="data-result"
          role={message.error ? "alert" : "status"}
        >
          {message.text}
        </div>
      )}
    </fieldset>
  );
}
