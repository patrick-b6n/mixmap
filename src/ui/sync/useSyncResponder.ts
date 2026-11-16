import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAppServices } from "@/app/app-services";
import { subscribe } from "@/app/events";
import { type Track } from "@/business/model";
import { summaryText } from "@/ui/settings/DataSection";
import { changeCount } from "@/business/sync";
import { m } from "@/paraglide/messages.js";

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
                ? m.sync_answered({ name: req.peerName, summary: summaryText(summary) })
                : m.sync_answered_nothing({ name: req.peerName }),
            );
          },
          async (e: unknown) => {
            const error = e instanceof Error ? e.message : String(e);
            await api.syncReply(req.requestId, { error }).catch(() => undefined);
            toast(m.sync_answer_failed({ error, name: req.peerName }));
          },
        );
      }),
    [api, sync],
  );
}
