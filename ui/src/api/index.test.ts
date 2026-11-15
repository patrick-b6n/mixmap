import { afterEach, describe, expect, it, vi } from "vitest";
import { artworkUrl, call } from "./index";

describe("call", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs JSON to /api/<command> without Tauri", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({ ok: 1 })));
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("window", {});
    expect(await call("x", { a: 1 })).toEqual({ ok: 1 });
    expect(fetch).toHaveBeenCalledWith("/api/x", expect.objectContaining({ body: '{"a":1}', method: "POST" }));
  });

  it("uses Tauri invoke when available", async () => {
    const invoke = vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>(async () => 42);
    vi.stubGlobal("window", { __TAURI_INTERNALS__: { invoke } });
    expect(await call("y", { b: 2 })).toBe(42);
    expect(invoke).toHaveBeenCalledWith("call", { args: { b: 2 }, command: "y" });
  });

  it("turns Tauri errors into Errors naming the command", async () => {
    const invoke = vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>(async () => {
      throw "rekordbox is not running";
    });
    vi.stubGlobal("window", { __TAURI_INTERNALS__: { invoke } });
    await expect(call("calibration_start")).rejects.toThrow("calibration_start: rekordbox is not running");
  });

  it("serves artwork through the devserver or the artwork scheme", () => {
    vi.stubGlobal("window", {});
    expect(artworkUrl("12", "small", 3)).toBe("/api/artwork/12?size=small&v=3");
    vi.stubGlobal("window", { __TAURI_INTERNALS__: { invoke: vi.fn<() => Promise<unknown>>() } });
    expect(artworkUrl("12", "large", 3)).toBe("http://artwork.localhost/12?size=large&v=3");
  });

  it("throws on HTTP errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async () => new Response("nope", { status: 500 })),
    );
    vi.stubGlobal("window", {});
    await expect(call("z")).rejects.toThrow("z: 500 nope");
  });
});
