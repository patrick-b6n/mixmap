import { afterEach, describe, expect, it, vi } from "vitest";
import { call } from "./index";

describe("call", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs JSON to /api/<command> without Tauri", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: 1 })));
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("window", {});
    expect(await call("x", { a: 1 })).toEqual({ ok: 1 });
    expect(fetch).toHaveBeenCalledWith("/api/x", expect.objectContaining({ body: '{"a":1}', method: "POST" }));
  });

  it("uses Tauri invoke when available", async () => {
    const invoke = vi.fn(async () => 42);
    vi.stubGlobal("window", { __TAURI_INTERNALS__: { invoke } });
    expect(await call("y", { b: 2 })).toBe(42);
    expect(invoke).toHaveBeenCalledWith("y", { b: 2 });
  });

  it("throws on HTTP errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    vi.stubGlobal("window", {});
    await expect(call("z")).rejects.toThrow("z: 500 nope");
  });
});
