import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAppServices } from "@/app/app-services";
import { subscribe } from "@/app/events";
import { type Track } from "@/business/model";
import { summaryText } from "@/ui/settings/DataSection";
import { changeCount } from "@/business/sync";

type SyncRequest = { data: unknown; peerId: string; peerName: string; requestId: string };

/**
 * Answers sync requests from paired devices ("Sync now" pressed over there): merge
 * their data here and send back what we had. Mounted once, app-wide.
 */
export function useSyncResponder(
  library: ReadonlyMap<string, Track>,
  onDataChanged: () => void,
): void {
  const { backend: api, sync } = useAppServices();
  // Latest values without resubscribing on every render.
  const latest = useRef({ library, onDataChanged });
  useEffect(() => {
    latest.current = { library, onDataChanged };
  }, [library, onDataChanged]);

  useEffect(
    () =>
      subscribe("sync-request", (payload) => {
        const req = payload as SyncRequest;
        const { library: lib, onDataChanged: changed } = latest.current;
        sync.answer(lib, req.data).then(
          async ({ data, summary }) => {
            await api.syncReply(req.requestId, { data, summary });
            changed();
            const n = changeCount(summary);
            toast(
              n > 0
                ? `Synced with ${req.peerName}: ${summaryText(summary)}`
                : `Synced with ${req.peerName}: no changes`,
            );
          },
          async (e: unknown) => {
            const error = e instanceof Error ? e.message : String(e);
            await api.syncReply(req.requestId, { error }).catch(() => undefined);
            toast(`Sync with ${req.peerName} failed: ${error}`);
          },
        );
      }),
    [api, sync],
  );
}
