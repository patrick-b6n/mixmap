import { Download, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/ui/components/ui/button";
import { inTauri } from "@/app/backend";
import { shouldPrompt, type UpdateCheck } from "@/business/updates";
import { overlayVisible } from "@/app/overlay-window";

/** Is a newer release available? (Startup check and "Check for updates" in Settings.) */
export async function checkForUpdate(): Promise<UpdateCheck> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<UpdateCheck>("update_check");
}

/** Download, verify, swap the exe and restart (resolves only on failure). */
export async function installUpdate(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("update_install");
}

/**
 * Desktop app: offer a newer release once after start ("Install & restart" / "Later"),
 * never automatically and never while the overlay is shown (it waits until it's hidden).
 */
export function UpdateBanner() {
  const [check, setCheck] = useState<UpdateCheck>();
  const [overlayShown, setOverlayShown] = useState(false);
  const [dismissed, setDismissed] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!inTauri()) return;
    const t = setTimeout(() => {
      checkForUpdate().then(setCheck, () => undefined); // offline: try again next start
    }, 3000);
    return () => clearTimeout(t);
  }, []);

  // The overlay may be shown or hidden later: look every few seconds.
  useEffect(() => {
    if (!inTauri()) return;
    const look = () => void overlayVisible().then(setOverlayShown, () => undefined);
    look();
    const t = setInterval(look, 5000);
    return () => clearInterval(t);
  }, []);

  if (!check || !shouldPrompt(check, overlayShown, dismissed)) return null;
  return (
    <div
      className="flex items-center gap-2 border-b border-primary/50 bg-primary/10 px-3 py-1 text-[13px]"
      data-testid="update-banner"
      role="status"
    >
      <Download className="size-4 flex-none text-primary" />
      <span className="min-w-0 flex-1 truncate">
        A new mixmap is available ({check.title}).{" "}
        {error && <span className="text-destructive">{error}</span>}
      </span>
      <Button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(undefined);
          installUpdate().catch((e: unknown) => {
            setError(String(e));
            setBusy(false);
          });
        }}
        variant="default"
      >
        {busy ? "Installing…" : "Install & restart"}
      </Button>
      <Button
        aria-label="Later"
        disabled={busy}
        onClick={() => setDismissed(check.latestVersion ?? undefined)}
        variant="ghost"
      >
        <X />
        Later
      </Button>
    </div>
  );
}
