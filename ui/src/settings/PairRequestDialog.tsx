import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { subscribe } from "../api";

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
      if (r.ok) toast(`Paired with ${r.name}`);
      else toast(`Pairing with ${r.name} failed: wrong code`);
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
          <DialogTitle className="text-base">Pair with {request.name}?</DialogTitle>
          <DialogDescription>
            {request.name} wants to sync MixMap data with this device. To allow it, enter this code on {request.name}:
          </DialogDescription>
        </DialogHeader>
        <div
          className="py-2 text-center font-mono text-3xl font-semibold tracking-[0.3em] tabular-nums"
          data-testid="pair-request-code"
        >
          {request.code.slice(0, 3)} {request.code.slice(3)}
        </div>
        <div className="text-center text-xs text-muted-foreground">Expires in {seconds} s</div>
        <DialogFooter>
          <Button onClick={() => setRequest(undefined)}>Hide</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
