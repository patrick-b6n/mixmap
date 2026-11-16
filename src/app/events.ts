// Backend events: Tauri events emitted by the Rust backend.

type Handler = (payload: unknown) => void;

/** Subscribe to a backend event. Returns an unsubscribe function. */
export function subscribe(event: string, handler: Handler): () => void {
  if (!window.__TAURI_INTERNALS__) return () => undefined;
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
