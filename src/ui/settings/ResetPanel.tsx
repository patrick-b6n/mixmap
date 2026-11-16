import { useForm } from "@tanstack/react-form";

import { Button } from "@/ui/components/ui/button";
import { Input } from "@/ui/components/ui/input";
import { m } from "@/paraglide/messages.js";

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
        {m.reset_description()} <code>{"%APPDATA%\\mixmap\\backups"}</code>.
      </div>
      <form.Field name="confirm">
        {(field) => (
          <label className="flex items-center gap-2">
            {m.reset_type_before()} <code className="font-semibold">{RESET_WORD}</code>{" "}
            {m.reset_type_after()}
            <Input
              aria-label={m.reset_confirm_label({ word: RESET_WORD })}
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
              {busy ? m.reset_running() : m.reset_submit()}
            </Button>
            <Button disabled={busy} onClick={onCancel} type="button">
              {m.common_cancel()}
            </Button>
          </div>
        )}
      </form.Subscribe>
    </form>
  );
}
