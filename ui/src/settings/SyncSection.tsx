import { Laptop, Link2, Wifi, WifiOff } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, type Peer, subscribe, SYNC_PROTOCOL, type SyncStatus } from "../api";

/** One device in the list: discovered on the network and/or paired. */
type Row = { id: string; name: string; online?: Peer; paired: boolean };

export function rows(status: SyncStatus): Row[] {
  const byId = new Map<string, Row>();
  for (const p of status.peers) byId.set(p.id, { id: p.id, name: p.name, online: p, paired: false });
  for (const p of status.paired) {
    const row = byId.get(p.id);
    if (row) row.paired = true;
    else byId.set(p.id, { id: p.id, name: p.name, paired: true });
  }
  return [...byId.values()].toSorted((a, b) => a.name.localeCompare(b.name));
}

/** Settings → Network sync: this device, devices on the LAN, pairing. */
export function SyncSection() {
  const [status, setStatus] = useState<SyncStatus>();
  const [error, setError] = useState<string>();
  /** Pairing in progress: waiting for the code shown on that device. */
  const [pairing, setPairing] = useState<{ code: string; id: string; name: string }>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error?: boolean; text: string }>();

  const load = useCallback(
    () =>
      api.syncStatus().then(
        (s) => {
          setStatus(s);
          setError(undefined);
        },
        (e) => setError(String(e)),
      ),
    [],
  );

  useEffect(() => {
    void load();
    const offPeers = subscribe("peers", (peers) => setStatus((s) => s && { ...s, peers: peers as Peer[] }));
    // Another device paired with this one (its code was shown here).
    const offFinished = subscribe("pair-finished", () => void load());
    const offReconnect = subscribe("reconnect", () => void load());
    return () => {
      offPeers();
      offFinished();
      offReconnect();
    };
  }, [load]);

  const startPairing = async (row: Row) => {
    setBusy(true);
    setMessage(undefined);
    try {
      const { name } = await api.pairStart(row.id);
      setPairing({ code: "", id: row.id, name });
    } catch (e) {
      setMessage({ error: true, text: `Couldn't reach ${row.name}: ${errorText(e)}` });
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    if (!pairing) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const peer = await api.pairConfirm(pairing.id, pairing.code);
      setPairing(undefined);
      setMessage({ text: `Paired with ${peer.name}.` });
      await load();
    } catch (err) {
      const text = errorText(err);
      // Keep the code field open for another try unless the request is gone.
      if (/start again|expired/.test(text)) setPairing(undefined);
      setMessage({ error: true, text });
    } finally {
      setBusy(false);
    }
  };

  const forget = async (row: Row) => {
    setMessage(undefined);
    try {
      await api.unpair(row.id);
      setMessage({ text: `${row.name} is no longer paired with this device.` });
      await load();
    } catch (e) {
      setMessage({ error: true, text: errorText(e) });
    }
  };

  const problem = error ?? status?.error;
  const list = status ? rows(status) : [];
  return (
    <fieldset className="flex flex-col gap-1.5 rounded-sm border px-3 py-2.5">
      <legend className="px-1 text-muted-foreground">Network sync</legend>
      {status?.device && (
        <div className="flex items-center gap-1.5" data-testid="this-device">
          <Laptop className="size-3.5 text-muted-foreground" />
          This device: <span className="font-medium">{status.device.name}</span>
        </div>
      )}
      {problem && <div className="text-destructive">{problem}</div>}
      {status && !status.error && (
        <>
          <div className="text-xs text-muted-foreground">Other MixMap devices:</div>
          {list.length === 0 ? (
            <div className="text-muted-foreground italic" data-testid="no-peers">
              None found yet. Start MixMap on another computer in the same network.
            </div>
          ) : (
            <ul aria-label="Devices" className="flex flex-col gap-1">
              {list.map((row) => {
                const incompatible = row.online && row.online.protocol !== SYNC_PROTOCOL;
                return (
                  <li className="flex min-h-6 items-center gap-1.5" data-peer={row.name} key={row.id}>
                    {row.online ? (
                      <Wifi className="size-3.5 flex-none text-muted-foreground" />
                    ) : (
                      <WifiOff className="size-3.5 flex-none text-muted-foreground" />
                    )}
                    <span className="truncate font-medium">{row.name}</span>
                    <span className="truncate text-xs text-muted-foreground tabular-nums">
                      {row.online ? `${row.online.addresses[0] ?? "?"}:${row.online.port}` : "offline"}
                    </span>
                    {row.paired && (
                      <span className="flex items-center gap-0.5 rounded-sm bg-muted px-1 text-xs text-muted-foreground">
                        <Link2 className="size-3" />
                        paired
                      </span>
                    )}
                    <span className="flex-1" />
                    {incompatible ? (
                      <span className="text-xs text-destructive">other MixMap version — update both</span>
                    ) : row.paired ? (
                      <Button
                        onClick={() => void forget(row)}
                        title="Remove the pairing on this device"
                        variant="ghost"
                      >
                        Forget
                      </Button>
                    ) : (
                      row.online && (
                        <Button disabled={busy || pairing !== undefined} onClick={() => void startPairing(row)}>
                          Pair…
                        </Button>
                      )
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {pairing && (
            <form
              className="flex flex-col gap-2 rounded-sm border border-dashed p-2"
              data-testid="pair-code"
              onSubmit={(e) => void confirm(e)}
            >
              <div>
                Enter the code shown on <span className="font-medium">{pairing.name}</span>:
              </div>
              <div className="flex gap-2">
                <Input
                  aria-label="Pairing code"
                  autoComplete="off"
                  autoFocus
                  className="w-28 text-center font-mono tracking-widest"
                  inputMode="numeric"
                  maxLength={7}
                  onChange={(e) => setPairing({ ...pairing, code: e.target.value })}
                  placeholder="000000"
                  value={pairing.code}
                />
                <Button disabled={busy || pairing.code.replace(/\D/g, "").length !== 6} type="submit" variant="default">
                  {busy ? "Pairing…" : "Pair"}
                </Button>
                <Button disabled={busy} onClick={() => setPairing(undefined)} type="button">
                  Cancel
                </Button>
              </div>
            </form>
          )}
          {message && (
            <div
              className={message.error ? "text-destructive" : undefined}
              data-testid="sync-message"
              role={message.error ? "alert" : "status"}
            >
              {message.text}
            </div>
          )}
        </>
      )}
    </fieldset>
  );
}

/** Backend errors arrive as "command: status text"; keep the text. */
export function errorText(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e);
  return s.replace(/^[a-z_]+: \d{3} /, "");
}
