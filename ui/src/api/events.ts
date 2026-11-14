// Backend events: server-sent events from the devserver, Tauri events later.
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
  const src = ensureSource();
  if (event === "reconnect") {
    reconnectHandlers.add(handler);
    return () => reconnectHandlers.delete(handler);
  }
  const listener = (e: MessageEvent) => handler(JSON.parse(e.data));
  src.addEventListener(event, listener);
  return () => src.removeEventListener(event, listener);
}
