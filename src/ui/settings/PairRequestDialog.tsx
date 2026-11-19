import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/ui/dialog";
import { subscribe } from "@/app/events";
import { m } from "@/paraglide/messages.js";

type Request = { code: string; expiresAt: number; id: string; name: string };

/**
 * Shown on this device when another one wants to pair: displays the 6-digit code to
 * type over there. Closes when pairing finishes, fails or the code expires.
 */
export function PairRequestDialog() {
  const [request, setRequest] = useState<Request>();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const offRequest = subscribe("pair-request", (p) => {
      const r = p as { code: string; expiresInMs: number; id: string; name: string };
      setRequest({ code: r.code, expiresAt: Date.now() + r.expiresInMs, id: r.id, name: r.name });
    });
    const offFinished = subscribe("pair-finished", (p) => {
      const r = p as { id: string; name: string; ok: boolean };
      setRequest((cur) => (cur?.id === r.id ? undefined : cur));
      if (r.ok) toast(m.pair_request_paired({ name: r.name }));
      else toast(m.pair_request_wrong_code({ name: r.name }));
    });
    return () => {
      offRequest();
      offFinished();
    };
  }, []);

  // Countdown; the request disappears when the code expires.
  useEffect(() => {
    if (!request) return;
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= request.expiresAt) setRequest(undefined);
    }, 1000);
    return () => clearInterval(t);
  }, [request]);

  if (!request) return null;
  const seconds = Math.max(0, Math.round((request.expiresAt - now) / 1000));
  return (
    <Dialog onOpenChange={(open) => !open && setRequest(undefined)} open>
      <DialogContent className="gap-3 rounded-md bg-card p-5 sm:max-w-100" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-base">
            {m.pair_request_title({ name: request.name })}
          </DialogTitle>
          <DialogDescription>
            {m.pair_request_description({ name: request.name })}
          </DialogDescription>
        </DialogHeader>
        <div
          className="py-2 text-center font-mono text-3xl font-semibold tracking-[0.3em] tabular-nums"
          data-testid="pair-request-code"
        >
          {request.code.slice(0, 3)} {request.code.slice(3)}
        </div>
        <div className="text-center text-xs text-muted-foreground">
          {m.pair_request_expires({ seconds })}
        </div>
        <DialogFooter>
          <Button onClick={() => setRequest(undefined)}>{m.pair_request_hide()}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
