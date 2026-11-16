import { Download, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { api, inTauri } from "../api";
import { asManifest, shouldPrompt, type UpdateManifest } from "../domain/updates";
import { isNewer } from "../domain/calver";
import { overlayVisible } from "./overlayWindow";

async function fetchManifest(): Promise<UpdateManifest | undefined> {
  const { invoke } = await import("@tauri-apps/api/core");
  return asManifest(await invoke<unknown>("update_manifest"));
}

/** Check on startup; result for "Check for updates" (Settings). */
export async function checkForUpdate(): Promise<{ current: string; latest?: UpdateManifest }> {
  const [{ version: current }, latest] = await Promise.all([api.hello(), fetchManifest()]);
  return { current, latest: latest && isNewer(latest.version, current) ? latest : undefined };
}

/** Download, verify, swap the exe and restart (resolves only on failure). */
export async function installUpdate(manifest: UpdateManifest): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("update_install", { manifest });
}

/**
 * Desktop app: offer a newer release once after start ("Install & restart" / "Later"),
 * never automatically and never while the overlay is shown (it waits until it's hidden).
 */
export function UpdateBanner() {
  const [latest, setLatest] = useState<UpdateManifest>();
  const [current, setCurrent] = useState<string>();
  const [overlayShown, setOverlayShown] = useState(false);
  const [dismissed, setDismissed] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!inTauri()) return;
    const t = setTimeout(() => {
      Promise.all([api.hello(), fetchManifest()]).then(
        ([h, m]) => {
          setCurrent(h.version);
          setLatest(m);
        },
        () => undefined, // offline: try again next start
      );
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

  const show = current !== undefined && shouldPrompt(latest, current, overlayShown, dismissed);
  if (!show || !latest) return null;
  return (
    <div
      className="flex items-center gap-2 border-b border-primary/50 bg-primary/10 px-3 py-1 text-[13px]"
      data-testid="update-banner"
      role="status"
    >
      <Download className="size-4 flex-none text-primary" />
      <span className="min-w-0 flex-1 truncate">
        A new mixmap is available ({latest.title}). {error && <span className="text-destructive">{error}</span>}
      </span>
      <Button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(undefined);
          installUpdate(latest).catch((e: unknown) => {
            setError(String(e));
            setBusy(false);
          });
        }}
        variant="default"
      >
        {busy ? "Installing…" : "Install & restart"}
      </Button>
      <Button aria-label="Later" disabled={busy} onClick={() => setDismissed(latest.version)} variant="ghost">
        <X />
        Later
      </Button>
    </div>
  );
}
