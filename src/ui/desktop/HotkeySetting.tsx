import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Keyboard } from "lucide-react";
import { useState } from "react";

import { useAppServices } from "@/app/app-services";
import { SETTINGS } from "@/business/settings";
import { Button } from "@/ui/components/ui/button";
import { Input } from "@/ui/components/ui/input";

import { queryKeys } from "../queries";
import { m } from "@/paraglide/messages.js";
import { errorMessage } from "@/ui/errors";

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(command, args);
}

/** "Overlay hotkey" field (desktop app only): registered right away, then remembered. */
export function HotkeySetting() {
  const { settings } = useAppServices();
  const queryClient = useQueryClient();
  const { data: current } = useQuery({
    queryKey: queryKeys.overlayHotkey,
    queryFn: () => invoke<string>("overlay_hotkey"),
  });
  const [message, setMessage] = useState<{ error?: boolean; text: string }>();

  const form = useForm({
    defaultValues: { hotkey: current ?? "" },
    onSubmit: async ({ value }) => {
      setMessage(undefined);
      try {
        const h = await invoke<string>("set_overlay_hotkey", { accelerator: value.hotkey });
        await settings.set(SETTINGS.overlayHotkey, h);
        queryClient.setQueryData(queryKeys.overlayHotkey, h);
        setMessage({ text: m.hotkey_saved({ hotkey: h }) });
      } catch (err) {
        setMessage({ error: true, text: errorMessage(err) });
      }
    },
  });

  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="hotkey">
        {(field) => (
          <label className="flex items-center gap-2">
            <Keyboard className="size-3.5 flex-none text-muted-foreground" />
            {m.hotkey_label()}
            <Input
              aria-label={m.hotkey_label()}
              className="w-40"
              name={field.name}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder="Ctrl+Alt+M"
              // The registered hotkey once it is known, until the user edits it.
              value={field.state.meta.isDirty ? field.state.value : (current ?? "")}
            />
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(submitting) => (
                <Button
                  disabled={
                    submitting || !field.state.value.trim() || field.state.value.trim() === current
                  }
                  type="submit"
                >
                  {m.common_save()}
                </Button>
              )}
            </form.Subscribe>
          </label>
        )}
      </form.Field>
      <span className="text-xs text-muted-foreground">{m.hotkey_hint()}</span>
      {message && (
        <span
          className={message.error ? "text-destructive" : undefined}
          data-testid="hotkey-message"
        >
          {message.text}
        </span>
      )}
    </form>
  );
}
