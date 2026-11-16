import { useForm } from "@tanstack/react-form";

import { Button } from "@/ui/components/ui/button";
import { Input } from "@/ui/components/ui/input";

/** What to type to confirm a reset. */
export const RESET_WORD = "RESET";

/** "Reset database": typed confirmation, then back up and delete all mixmap data. */
export function ResetPanel({
  onCancel,
  onReset,
}: {
  onCancel: () => void;
  onReset: () => Promise<void>;
}) {
  const form = useForm({
    defaultValues: { confirm: "" },
    onSubmit: () => onReset(),
  });
  return (
    <form
      className="flex flex-col gap-2 rounded-sm border border-destructive/60 p-2"
      data-testid="reset-panel"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div>
        Deletes all links, graph positions and manual matches. Your rekordbox library is not
        touched. A backup is saved first to <code>{"%APPDATA%\\mixmap\\backups"}</code>.
      </div>
      <form.Field name="confirm">
        {(field) => (
          <label className="flex items-center gap-2">
            Type <code className="font-semibold">{RESET_WORD}</code> to confirm:
            <Input
              aria-label={`Type ${RESET_WORD} to confirm`}
              autoComplete="off"
              className="w-28"
              name={field.name}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              value={field.state.value}
            />
          </label>
        )}
      </form.Field>
      <form.Subscribe selector={(s) => [s.isSubmitting, s.values.confirm === RESET_WORD] as const}>
        {([busy, confirmed]) => (
          <div className="flex gap-2">
            <Button disabled={busy || !confirmed} type="submit" variant="destructive">
              {busy ? "Resetting…" : "Back up and reset"}
            </Button>
            <Button disabled={busy} onClick={onCancel} type="button">
              Cancel
            </Button>
          </div>
        )}
      </form.Subscribe>
    </form>
  );
}
