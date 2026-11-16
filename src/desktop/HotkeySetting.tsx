import { Keyboard } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { appDb } from "@/app/database";
import { setSetting, SETTINGS } from "../db/settings";

/** "Overlay hotkey" field (desktop app only): registered right away, then remembered. */
export function HotkeySetting() {
  const [current, setCurrent] = useState<string>();
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<{ error?: boolean; text: string }>();

  useEffect(() => {
    void import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke<string>("overlay_hotkey").then((h) => {
        setCurrent(h);
        setValue(h);
      }),
    );
  }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(undefined);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const h = await invoke<string>("set_overlay_hotkey", { accelerator: value });
      await setSetting(appDb, SETTINGS.overlayHotkey, h);
      setCurrent(h);
      setMessage({ text: `${h} now shows and hides the overlay.` });
    } catch (err) {
      setMessage({ error: true, text: String(err) });
    }
  };

  return (
    <form className="flex flex-col gap-1" onSubmit={(e) => void save(e)}>
      <label className="flex items-center gap-2">
        <Keyboard className="size-3.5 flex-none text-muted-foreground" />
        Overlay hotkey
        <Input
          aria-label="Overlay hotkey"
          className="w-40"
          onChange={(e) => setValue(e.target.value)}
          placeholder="Ctrl+Alt+M"
          value={value}
        />
        <Button disabled={!value.trim() || value.trim() === current} type="submit">
          Save
        </Button>
      </label>
      <span className="text-xs text-muted-foreground">
        Works everywhere, also while rekordbox is in front. E.g. Ctrl+Alt+M, Ctrl+Shift+F9.
      </span>
      {message && (
        <span className={message.error ? "text-destructive" : undefined} data-testid="hotkey-message">
          {message.text}
        </span>
      )}
    </form>
  );
}
