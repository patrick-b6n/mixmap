import { useForm } from "@tanstack/react-form";

import { Button } from "@/ui/components/ui/button";
import { Input } from "@/ui/components/ui/input";

/** The digits of a typed pairing code (spaces and dashes allowed while typing). */
export const codeDigits = (code: string): string => code.replace(/\D/g, "");

/**
 * "Enter the code shown on <device>": the 6-digit code from the other device. Stays
 * open after a wrong code (the caller closes it when the request is gone).
 */
export function PairCodeForm({
  deviceName,
  onCancel,
  onSubmit,
}: {
  deviceName: string;
  onCancel: () => void;
  onSubmit: (code: string) => Promise<void>;
}) {
  const form = useForm({
    defaultValues: { code: "" },
    onSubmit: ({ value }) => onSubmit(value.code),
  });
  return (
    <form
      className="flex flex-col gap-2 rounded-sm border border-dashed p-2"
      data-testid="pair-code"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div>
        Enter the code shown on <span className="font-medium">{deviceName}</span>:
      </div>
      <div className="flex gap-2">
        <form.Field name="code">
          {(field) => (
            <Input
              aria-label="Pairing code"
              autoComplete="off"
              autoFocus
              className="w-28 text-center font-mono tracking-widest"
              inputMode="numeric"
              maxLength={7}
              name={field.name}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder="000000"
              value={field.state.value}
            />
          )}
        </form.Field>
        <form.Subscribe
          selector={(s) => [s.isSubmitting, codeDigits(s.values.code).length] as const}
        >
          {([busy, digits]) => (
            <>
              <Button disabled={busy || digits !== 6} type="submit" variant="default">
                {busy ? "Pairing…" : "Pair"}
              </Button>
              <Button disabled={busy} onClick={onCancel} type="button">
                Cancel
              </Button>
            </>
          )}
        </form.Subscribe>
      </div>
    </form>
  );
}
