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
import { m } from "@/paraglide/messages.js";

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
  if (s < 60) return m.sync_ago_now();
  if (s < 3600) return m.sync_ago_minutes({ minutes: Math.round(s / 60) });
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
      setMessage({
        error: true,
        text: m.sync_unreachable({ error: errorText(e), name: row.name }),
      });
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
      setMessage({ text: m.sync_paired({ name: peer.name }) });
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
      const got = changeCount(result.received)
        ? summaryText(result.received)
        : m.sync_nothing_new();
      const gave = changeCount(result.sent) ? summaryText(result.sent!) : m.sync_nothing_new();
      setMessage({ text: m.sync_done({ gave, got, name: row.name }) });
      await load();
    } catch (e) {
      setMessage({
        error: true,
        text: m.sync_failed({ error: errorText(e), name: row.name }),
      });
    } finally {
      setSyncing(undefined);
    }
  };

  const forget = async (row: Row) => {
    setMessage(undefined);
    try {
      await api.unpair(row.id);
      setMessage({ text: m.sync_forgotten({ name: row.name }) });
      await load();
    } catch (e) {
      setMessage({ error: true, text: errorText(e) });
    }
  };

  const problem = error ?? status?.error;
  const list = status ? rows(status) : [];
  return (
    <fieldset className="flex flex-col gap-1.5 rounded-sm border px-3 py-2.5">
      <legend className="px-1 text-muted-foreground">{m.sync_legend()}</legend>
      {status?.device && (
        <div className="flex items-center gap-1.5" data-testid="this-device">
          <Laptop className="size-3.5 text-muted-foreground" />
          {m.sync_this_device()} <span className="font-medium">{status.device.name}</span>
        </div>
      )}
      {problem && <div className="text-destructive">{problem}</div>}
      {status && !status.error && (
        <>
          <div className="text-xs text-muted-foreground">{m.sync_other_devices()}</div>
          {list.length === 0 ? (
            <div className="text-muted-foreground italic" data-testid="no-peers">
              {m.sync_no_peers()}
            </div>
          ) : (
            <ul aria-label={m.sync_devices()} className="flex flex-col gap-1">
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
                        : m.sync_offline()}
                    </span>
                    {row.paired && (
                      <span
                        className="flex items-center gap-0.5 rounded-sm bg-muted px-1 text-xs text-muted-foreground"
                        title={
                          row.lastSyncAt
                            ? m.sync_last_synced({
                                date: new Date(row.lastSyncAt).toLocaleString(),
                              })
                            : m.sync_never_synced()
                        }
                      >
                        <Link2 className="size-3" />
                        {row.lastSyncAt
                          ? m.sync_synced_ago({ ago: ago(row.lastSyncAt) })
                          : m.sync_paired_badge()}
                      </span>
                    )}
                    <span className="flex-1" />
                    {incompatible ? (
                      <span className="text-xs text-destructive">{m.sync_incompatible()}</span>
                    ) : row.paired ? (
                      <>
                        {row.online && (
                          <Button
                            disabled={syncing !== undefined}
                            onClick={() => void sync(row)}
                            title={m.sync_now_hint()}
                            variant="default"
                          >
                            <RefreshCw
                              className={syncing === row.id ? "animate-spin" : undefined}
                            />
                            {syncing === row.id ? m.sync_syncing() : m.sync_now()}
                          </Button>
                        )}
                        <Button
                          disabled={syncing !== undefined}
                          onClick={() => void forget(row)}
                          title={m.sync_forget_hint()}
                          variant="ghost"
                        >
                          {m.sync_forget()}
                        </Button>
                      </>
                    ) : (
                      row.online && (
                        <Button
                          disabled={busy || pairing !== undefined}
                          onClick={() => void startPairing(row)}
                        >
                          {m.sync_pair()}
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
