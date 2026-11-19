import { useState } from "react";
import { Button } from "@/ui/components/ui/button";
import { Label } from "@/ui/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/ui/components/ui/radio-group";
import type { Track } from "@/business/model";
import { openTextFile, saveTextFile } from "@/app/files";
import { useAppServices } from "@/app/app-services";
import { ResetPanel } from "./ResetPanel";
import {
  exportFileName,
  type ImportMode,
  type MixmapExport,
  parseExport,
  serializeExport,
} from "@/business/exchange";
import type { Counts, MergeSummary } from "@/business/merge";
import { m } from "@/paraglide/messages.js";
import { errorMessage } from "@/ui/errors";

type Props = {
  library: ReadonlyMap<string, Track>;
  /** mixmap data changed (import): re-run matching and reload. */
  onDataChanged: () => void;
};

/** "3 added, 1 updated" (only non-zero parts), or undefined when nothing changed. */
function describe(c: Counts): string | undefined {
  const parts = [
    c.added && m.data_count_added({ count: c.added }),
    c.updated && m.data_count_updated({ count: c.updated }),
    c.deleted && m.data_count_deleted({ count: c.deleted }),
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}

/** "3 links, 2 cards, 4 tracks" of an export. */
function contents(data: MixmapExport): string {
  return m.data_contents({
    cards: m.data_count_cards({ count: data.nodes.length }),
    links: m.data_count_links({ count: data.links.length }),
    tracks: m.data_count_tracks({ count: data.tracks.length }),
  });
}

export function summaryText(s: MergeSummary): string {
  const lines = (
    [
      [m.data_summary_links(), s.links],
      [m.data_summary_nodes(), s.nodes],
      [m.data_summary_tracks(), s.tracks],
      [m.data_summary_manual_matches(), s.manualMatches],
    ] as const
  ).flatMap(([label, c]) => {
    const d = describe(c);
    return d ? [m.data_summary_line({ changes: d, label })] : [];
  });
  return lines.length ? lines.join(" · ") : m.data_summary_nothing();
}

/** Settings → mixmap data: export, import (merge / replace), reset. */
export function DataSection({ library, onDataChanged }: Props) {
  const { backup: writeBackup, exchange } = useAppServices();
  const [message, setMessage] = useState<{ error?: boolean; text: string }>();
  const [pending, setPending] = useState<{ data: MixmapExport; name: string }>();
  const [mode, setMode] = useState<ImportMode>("merge");
  const [busy, setBusy] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  const runReset = async () => {
    setBusy(true);
    setMessage(undefined);
    try {
      const backup = await writeBackup(library, "before-reset");
      await exchange.reset();
      setResetOpen(false);
      onDataChanged();
      setMessage({ text: m.data_reset_done({ backup }) });
    } catch (e) {
      setMessage({ error: true, text: m.data_reset_failed({ error: errorMessage(e) }) });
    } finally {
      setBusy(false);
    }
  };

  const exportFile = async () => {
    setMessage(undefined);
    try {
      const data = await exchange.export(library);
      saveTextFile(exportFileName(), serializeExport(data));
      setMessage({
        text: m.data_exported({ contents: contents(data) }),
      });
    } catch (e) {
      setMessage({ error: true, text: m.data_export_failed({ error: errorMessage(e) }) });
    }
  };

  const chooseFile = async () => {
    setMessage(undefined);
    try {
      const file = await openTextFile(".json,application/json");
      if (!file) return;
      setResetOpen(false);
      setPending({ data: parseExport(file.text), name: file.name });
      setMode("merge");
    } catch (e) {
      setPending(undefined);
      setMessage({ error: true, text: errorMessage(e) });
    }
  };

  const runImport = async () => {
    if (!pending) return;
    setBusy(true);
    setMessage(undefined);
    try {
      let backup = "";
      if (mode === "replace") backup = await writeBackup(library, "before-import");
      const summary = await exchange.import(pending.data, mode, library);
      setPending(undefined);
      onDataChanged();
      setMessage({
        text: backup
          ? m.data_import_done_backup({ backup, summary: summaryText(summary) })
          : summaryText(summary),
      });
    } catch (e) {
      setMessage({ error: true, text: m.data_import_failed({ error: errorMessage(e) }) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <fieldset className="flex flex-col gap-1.5 rounded-sm border px-3 py-2.5">
      <legend className="px-1 text-muted-foreground">{m.data_legend()}</legend>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void exportFile()} title={m.data_export_hint()}>
          {m.data_export()}
        </Button>
        <Button disabled={busy} onClick={() => void chooseFile()}>
          {m.data_import()}
        </Button>
        <Button
          className="ml-auto"
          disabled={busy}
          onClick={() => {
            setPending(undefined);
            setMessage(undefined);
            setResetOpen(true);
          }}
          variant="ghost"
        >
          {m.data_reset()}
        </Button>
      </div>
      {resetOpen && <ResetPanel onCancel={() => setResetOpen(false)} onReset={runReset} />}
      {pending && (
        <div
          className="flex flex-col gap-2 rounded-sm border border-dashed p-2"
          data-testid="import-preview"
        >
          <div>
            <span className="font-medium [overflow-wrap:anywhere]">{pending.name}</span>
            <div className="text-xs text-muted-foreground">
              {contents(pending.data)}
              {pending.data.exportedAt > 0 &&
                ` · ${m.data_exported_at({ date: new Date(pending.data.exportedAt).toLocaleString() })}`}
            </div>
          </div>
          <RadioGroup
            className="gap-1.5"
            onValueChange={(v) => setMode(v as ImportMode)}
            value={mode}
          >
            <div className="flex items-start gap-2">
              <RadioGroupItem className="mt-0.5" id="import-merge" value="merge" />
              <Label
                className="flex-col items-start gap-0 text-[13px] font-normal"
                htmlFor="import-merge"
              >
                {m.data_import_merge()}
                <span className="text-xs text-muted-foreground">{m.data_import_merge_hint()}</span>
              </Label>
            </div>
            <div className="flex items-start gap-2">
              <RadioGroupItem className="mt-0.5" id="import-replace" value="replace" />
              <Label
                className="flex-col items-start gap-0 text-[13px] font-normal"
                htmlFor="import-replace"
              >
                {m.data_import_replace()}
                <span className="text-xs text-muted-foreground">
                  {m.data_import_replace_hint()}
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
              {busy
                ? m.data_importing()
                : mode === "replace"
                  ? m.data_import_replace_submit()
                  : m.data_import_merge()}
            </Button>
            <Button disabled={busy} onClick={() => setPending(undefined)}>
              {m.common_cancel()}
            </Button>
          </div>
        </div>
      )}
      {message && (
        <div
          className={
            message.error ? "text-destructive [overflow-wrap:anywhere]" : "[overflow-wrap:anywhere]"
          }
          data-testid="data-result"
          role={message.error ? "alert" : "status"}
        >
          {message.text}
        </div>
      )}
    </fieldset>
  );
}
