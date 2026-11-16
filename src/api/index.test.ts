import { afterEach, describe, expect, it, vi } from "vitest";
import { artworkUrl, call } from "./index";

describe("call", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refuses to run without Tauri", async () => {
    vi.stubGlobal("window", {});
    await expect(call("x")).rejects.toThrow("x: mixmap only runs as a desktop app");
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

  it("serves artwork through the artwork scheme", () => {
    expect(artworkUrl("12", "large", 3)).toBe("http://artwork.localhost/12?size=large&v=3");
  });
});
