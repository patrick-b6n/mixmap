import { Laptop, Wifi } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type Peer, subscribe, SYNC_PROTOCOL, type SyncStatus } from "../api";

/** Settings → Network sync: this device and the MixMap instances found on the LAN. */
export function SyncSection() {
  const [status, setStatus] = useState<SyncStatus>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let live = true;
    const load = () =>
      api.syncStatus().then(
        (s) => live && (setStatus(s), setError(undefined)),
        (e) => live && setError(String(e)),
      );
    void load();
    const offPeers = subscribe("peers", (peers) => setStatus((s) => s && { ...s, peers: peers as Peer[] }));
    const offReconnect = subscribe("reconnect", () => void load());
    return () => {
      live = false;
      offPeers();
      offReconnect();
    };
  }, []);

  const problem = error ?? status?.error;
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
          <div className="text-xs text-muted-foreground">Other MixMap instances on this network:</div>
          {status.peers.length === 0 ? (
            <div className="text-muted-foreground italic" data-testid="no-peers">
              None found yet. Start MixMap on another computer in the same network.
            </div>
          ) : (
            <ul aria-label="Devices on this network" className="flex flex-col gap-1">
              {status.peers.map((p) => (
                <li className="flex items-center gap-1.5" key={p.id}>
                  <Wifi className="size-3.5 text-muted-foreground" />
                  <span className="font-medium">{p.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {p.addresses[0] ?? "?"}:{p.port}
                  </span>
                  {p.protocol !== SYNC_PROTOCOL && (
                    <span className="text-xs text-destructive">different MixMap version — update both to sync</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </fieldset>
  );
}
