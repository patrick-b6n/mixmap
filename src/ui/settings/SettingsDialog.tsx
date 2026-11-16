import { useState } from "react";
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
import { Label } from "@/ui/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/ui/components/ui/radio-group";
import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useAppServices } from "@/app/app-services";
import { queryKeys } from "../queries";
import { type LibrarySource, type LibraryStatus, type Track } from "@/business/model";
import { SETTINGS } from "@/business/settings";
import { inTauri } from "@/app/backend";
import { checkForUpdate } from "@/ui/desktop/UpdateBanner";
import { DataSection } from "./DataSection";
import { NowPlayingSection } from "./NowPlayingSection";
import { SyncSection } from "./SyncSection";
import { m } from "@/paraglide/messages.js";
import { errorMessage } from "@/ui/errors";

type Props = {
  /** rekordbox tracks by id (to describe manual matches portably in exports). */
  library: ReadonlyMap<string, Track>;
  onClose: () => void;
  /** mixmap data changed (import, reset): re-run matching and reload. */
  onDataChanged: () => void;
  status?: LibraryStatus;
};

type Kind = LibrarySource["kind"];

const KINDS: { kind: Kind; label: () => string }[] = [
  { kind: "auto", label: m.settings_source_auto },
  { kind: "masterDb", label: m.settings_source_master_db },
  { kind: "xml", label: m.settings_source_xml },
];

/** Settings: where the rekordbox library comes from. */
export function SettingsDialog({ library, onClose, onDataChanged, status }: Props) {
  const { backend: api, settings } = useAppServices();
  const current = status?.source ?? { kind: "auto" };
  const [result, setResult] = useState<string>();
  const { data: version } = useQuery({ queryKey: queryKeys.version, queryFn: api.version });
  const [updateInfo, setUpdateInfo] = useState<string>();

  const form = useForm({
    defaultValues: { kind: current.kind, path: current.kind === "auto" ? "" : current.path },
    onSubmit: async ({ value }) => {
      const source: LibrarySource =
        value.kind === "auto" ? { kind: "auto" } : { kind: value.kind, path: value.path.trim() };
      setResult(undefined);
      try {
        const s = await api.setLibrarySource(source);
        if (s.error) {
          setResult(m.settings_source_error({ error: s.error }));
        } else {
          // Only a source that loaded is remembered for the next start.
          await settings.set(SETTINGS.librarySource, source);
          setResult(m.settings_source_loaded({ playlists: s.playlistCount, tracks: s.trackCount }));
        }
      } catch (e) {
        setResult(errorMessage(e));
      }
    },
  });

  return (
    <Dialog defaultOpen onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-3 rounded-md bg-card p-5 sm:max-w-140" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-base">{m.settings_title()}</DialogTitle>
          <DialogDescription className="sr-only">{m.settings_description()}</DialogDescription>
        </DialogHeader>
        <fieldset className="flex flex-col gap-1.5 rounded-sm border px-3 py-2.5">
          <legend className="px-1 text-muted-foreground">{m.settings_source_legend()}</legend>
          <form.Field
            listeners={{
              // A path only makes sense for its kind: switching clears it.
              onChange: ({ value }) => {
                form.setFieldValue(
                  "path",
                  current.kind === value && current.kind !== "auto" ? current.path : "",
                );
                setResult(undefined);
              },
            }}
            name="kind"
          >
            {(field) => (
              <RadioGroup
                className="gap-1.5"
                onValueChange={(v) => field.handleChange(v as Kind)}
                value={field.state.value}
              >
                {KINDS.map((k) => (
                  <div className="flex items-center gap-2" key={k.kind}>
                    <RadioGroupItem id={`source-${k.kind}`} value={k.kind} />
                    <Label className="text-[13px] font-normal" htmlFor={`source-${k.kind}`}>
                      {k.label()}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            )}
          </form.Field>
          <form.Subscribe selector={(state) => state.values.kind}>
            {(kind) =>
              kind !== "auto" && (
                <form.Field
                  name="path"
                  validators={{
                    onSubmit: ({ value }) =>
                      value.trim() ? undefined : m.settings_path_required(),
                  }}
                >
                  {(field) => (
                    <>
                      <Input
                        aria-invalid={field.state.meta.errors.length > 0 || undefined}
                        aria-label={m.settings_path_label()}
                        className="mt-1"
                        name={field.name}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                        placeholder={
                          kind === "xml" ? "C:\\Users\\…\\rekordbox.xml" : "C:\\Users\\…\\master.db"
                        }
                        value={field.state.value}
                      />
                      {field.state.meta.errors.length > 0 && (
                        <div className="text-destructive" role="alert">
                          {field.state.meta.errors.join(" ")}
                        </div>
                      )}
                    </>
                  )}
                </form.Field>
              )
            }
          </form.Subscribe>
          {status?.location && (
            <div className="text-xs [overflow-wrap:anywhere] text-muted-foreground">
              {m.settings_source_current({ path: status.location.dbPath })}
            </div>
          )}
        </fieldset>
        {result && <div data-testid="settings-result">{result}</div>}
        <DataSection library={library} onDataChanged={onDataChanged} />
        <NowPlayingSection library={library} />
        <SyncSection library={library} onDataChanged={onDataChanged} />
        <DialogFooter className="items-center">
          <span className="mr-auto text-xs text-muted-foreground" data-testid="app-version">
            {version && m.settings_version({ version })}
            {inTauri() && (
              <button
                className="ml-2 underline-offset-2 hover:underline"
                onClick={() => {
                  setUpdateInfo(m.settings_update_checking());
                  checkForUpdate().then(
                    (r) =>
                      setUpdateInfo(
                        r.updateAvailable
                          ? m.settings_update_available({ title: r.title ?? "" })
                          : m.settings_update_none(),
                      ),
                    (e: unknown) =>
                      setUpdateInfo(m.settings_update_failed({ error: errorMessage(e) })),
                  );
                }}
                type="button"
              >
                {m.settings_update_check()}
              </button>
            )}
            {updateInfo && (
              <span className="ml-2" data-testid="update-info">
                {updateInfo}
              </span>
            )}
          </span>
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(busy) => (
              <Button disabled={busy} onClick={() => void form.handleSubmit()}>
                {busy ? m.common_loading() : m.settings_apply()}
              </Button>
            )}
          </form.Subscribe>
          <DialogClose render={<Button />}>{m.common_close()}</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
