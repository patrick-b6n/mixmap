import { Laptop, Link2, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/ui/components/ui/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppServices } from "@/app/app-services";
import { type Peer, SYNC_PROTOCOL, type SyncStatus, type Track } from "@/business/model";
import { subscribe } from "@/app/events";
import { changeCount } from "@/business/sync";
import { queryKeys } from "../queries";
import { summaryText } from "./DataSection";
import { PairCodeForm } from "./PairCodeForm";

/** One device in the list: discovered on the network and/or paired. */
type Row = { id: string; lastSyncAt?: number; name: string; online?: Peer; paired: boolean };

export function rows(status: SyncStatus): Row[] {
  const byId = new Map<string, Row>();
  for (const p of status.peers)
    byId.set(p.id, { id: p.id, name: p.name, online: p, paired: false });
  for (const p of status.paired) {
    const row = byId.get(p.id);
    const lastSyncAt = p.lastSyncAt ?? undefined;
    if (row) Object.assign(row, { lastSyncAt, paired: true });
    else byId.set(p.id, { id: p.id, lastSyncAt, name: p.name, paired: true });
  }
  return [...byId.values()].toSorted((a, b) => a.name.localeCompare(b.name));
}

type Props = {
  library: ReadonlyMap<string, Track>;
  /** mixmap data changed (a sync merged something): re-run matching and reload. */
  onDataChanged: () => void;
};

/** "2 min ago", "yesterday 21:14"-style, short. */
function ago(ms: number, now = Date.now()): string {
  const s = Math.round((now - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(ms).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

/** Settings → Network sync: this device, devices on the LAN, pairing, Sync now. */
export function SyncSection({ library, onDataChanged }: Props) {
  const { backend: api, sync: syncService } = useAppServices();
  const [syncing, setSyncing] = useState<string>();
  /** Pairing in progress: waiting for the code shown on that device. */
  const [pairing, setPairing] = useState<{ id: string; name: string }>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error?: boolean; text: string }>();

  const queryClient = useQueryClient();
  const statusQuery = useQuery({ queryKey: queryKeys.syncStatus, queryFn: api.syncStatus });
  const status = statusQuery.data;
  const error = statusQuery.error ? String(statusQuery.error) : undefined;
  const load = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.syncStatus }),
    [queryClient],
  );
  const setStatus = useCallback(
    (update: (s: SyncStatus | undefined) => SyncStatus | undefined) =>
      queryClient.setQueryData(queryKeys.syncStatus, update),
    [queryClient],
  );

  useEffect(() => {
    const offPeers = subscribe("peers", (peers) =>
      setStatus((s) => s && { ...s, peers: peers as Peer[] }),
    );
    // Another device paired with this one (its code was shown here).
    const offFinished = subscribe("pair-finished", () => void load());
    const offReconnect = subscribe("reconnect", () => void load());
    return () => {
      offPeers();
      offFinished();
      offReconnect();
    };
  }, [load, setStatus]);

  const startPairing = async (row: Row) => {
    setBusy(true);
    setMessage(undefined);
    try {
      const { name } = await api.pairStart(row.id);
      setPairing({ id: row.id, name });
    } catch (e) {
      setMessage({ error: true, text: `Couldn't reach ${row.name}: ${errorText(e)}` });
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (code: string) => {
    if (!pairing) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const peer = await api.pairConfirm(pairing.id, code);
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

  const sync = async (row: Row) => {
    setSyncing(row.id);
    setMessage(undefined);
    try {
      const result = await syncService.now(row.id, library);
      onDataChanged();
      const got = changeCount(result.received) ? summaryText(result.received) : "nothing new";
      const gave = changeCount(result.sent) ? summaryText(result.sent!) : "nothing new";
      setMessage({ text: `Synced with ${row.name}. Here: ${got} Over there: ${gave}` });
      await load();
    } catch (e) {
      setMessage({
        error: true,
        text: `Sync with ${row.name} failed, nothing changed here: ${errorText(e)}`,
      });
    } finally {
      setSyncing(undefined);
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
          <div className="text-xs text-muted-foreground">Other mixmap devices:</div>
          {list.length === 0 ? (
            <div className="text-muted-foreground italic" data-testid="no-peers">
              None found yet. Start mixmap on another computer in the same network.
            </div>
          ) : (
            <ul aria-label="Devices" className="flex flex-col gap-1">
              {list.map((row) => {
                const incompatible = row.online && row.online.protocol !== SYNC_PROTOCOL;
                return (
                  <li
                    className="flex min-h-6 items-center gap-1.5"
                    data-peer={row.name}
                    key={row.id}
                  >
                    {row.online ? (
                      <Wifi className="size-3.5 flex-none text-muted-foreground" />
                    ) : (
                      <WifiOff className="size-3.5 flex-none text-muted-foreground" />
                    )}
                    <span className="truncate font-medium">{row.name}</span>
                    <span className="truncate text-xs text-muted-foreground tabular-nums">
                      {row.online
                        ? `${row.online.addresses[0] ?? "?"}:${row.online.port}`
                        : "offline"}
                    </span>
                    {row.paired && (
                      <span
                        className="flex items-center gap-0.5 rounded-sm bg-muted px-1 text-xs text-muted-foreground"
                        title={
                          row.lastSyncAt
                            ? `Last synced ${new Date(row.lastSyncAt).toLocaleString()}`
                            : "Never synced"
                        }
                      >
                        <Link2 className="size-3" />
                        {row.lastSyncAt ? `synced ${ago(row.lastSyncAt)}` : "paired"}
                      </span>
                    )}
                    <span className="flex-1" />
                    {incompatible ? (
                      <span className="text-xs text-destructive">
                        other mixmap version — update both
                      </span>
                    ) : row.paired ? (
                      <>
                        {row.online && (
                          <Button
                            disabled={syncing !== undefined}
                            onClick={() => void sync(row)}
                            title="Exchange links and positions both ways (newer changes win)"
                            variant="default"
                          >
                            <RefreshCw
                              className={syncing === row.id ? "animate-spin" : undefined}
                            />
                            {syncing === row.id ? "Syncing…" : "Sync now"}
                          </Button>
                        )}
                        <Button
                          disabled={syncing !== undefined}
                          onClick={() => void forget(row)}
                          title="Remove the pairing on this device"
                          variant="ghost"
                        >
                          Forget
                        </Button>
                      </>
                    ) : (
                      row.online && (
                        <Button
                          disabled={busy || pairing !== undefined}
                          onClick={() => void startPairing(row)}
                        >
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
            <PairCodeForm
              deviceName={pairing.name}
              key={pairing.id}
              onCancel={() => setPairing(undefined)}
              onSubmit={confirm}
            />
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
