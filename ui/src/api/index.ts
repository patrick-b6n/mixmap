// Single API adapter: HTTP to the devserver in the browser, Tauri `invoke` later.
// Every backend call goes through `call(command, args)`; the command name maps to
// `POST /api/<command>` over HTTP and to the Tauri command of the same name.

export type Hello = { message: string; version: string };

type Args = Record<string, unknown>;

declare global {
  interface Window {
    __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: Args) => Promise<unknown> };
  }
}

export async function call<T>(command: string, args: Args = {}): Promise<T> {
  const tauri = window.__TAURI_INTERNALS__;
  if (tauri) return (await tauri.invoke(command, args)) as T;
  const res = await fetch(`/api/${command}`, {
    body: JSON.stringify(args),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!res.ok) throw new Error(`${command}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export const api = {
  hello: () => call<Hello>("hello"),
};
