// Backend events: server-sent events from the devserver, Tauri events in the app.
// The special event "reconnect" fires when the stream reconnects after a drop;
// events may have been missed, so subscribers should refetch.

type Handler = (payload: unknown) => void;

let source: EventSource | undefined;
let opened = false;
const reconnectHandlers = new Set<Handler>();

function ensureSource(): EventSource {
  if (!source) {
    source = new EventSource("/api/events");
    source.addEventListener("open", () => {
      if (opened) reconnectHandlers.forEach((h) => h(undefined));
      opened = true;
    });
  }
  return source;
}

/** Subscribe to a backend event. Returns an unsubscribe function. */
export function subscribe(event: string, handler: Handler): () => void {
  if (window.__TAURI_INTERNALS__) return subscribeTauri(event, handler);
  const src = ensureSource();
  if (event === "reconnect") {
    reconnectHandlers.add(handler);
    return () => reconnectHandlers.delete(handler);
  }
  const listener = (e: MessageEvent) => handler(JSON.parse(e.data));
  src.addEventListener(event, listener);
  return () => src.removeEventListener(event, listener);
}

/** Tauri: events of the same names; there is no reconnect (the backend is in-process). */
function subscribeTauri(event: string, handler: Handler): () => void {
  if (event === "reconnect") return () => undefined;
  let off: (() => void) | undefined;
  let cancelled = false;
  void import("@tauri-apps/api/event").then(({ listen }) =>
    listen(event, (e) => handler(e.payload)).then((unlisten) => {
      if (cancelled) unlisten();
      else off = unlisten;
    }),
  );
  return () => {
    cancelled = true;
    off?.();
  };
}
