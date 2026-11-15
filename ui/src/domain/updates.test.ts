import { describe, expect, it } from "vitest";
import { asManifest, shouldPrompt } from "./updates";

const m = {
  sha256: "ab",
  size: 10,
  title: "2026-11-15 15:00:00 UTC",
  url: "https://github.com/x/y/releases/download/v2026.1115.150000/MixMap.exe",
  version: "2026.1115.150000",
};

describe("updates", () => {
  it("accepts well-formed manifests only", () => {
    expect(asManifest(m)).toEqual(m);
    expect(asManifest({ ...m, title: undefined })?.title).toBe(m.version);
    expect(asManifest(null)).toBeUndefined();
    expect(asManifest({ ...m, size: "10" })).toBeUndefined();
  });

  it("offers only newer builds, not while the overlay is shown, not after Later", () => {
    expect(shouldPrompt(m, "2026.1115.140000", false, undefined)).toBe(true);
    expect(shouldPrompt(m, "2026.1115.150000", false, undefined)).toBe(false);
    expect(shouldPrompt(m, "2026.1116.0", false, undefined)).toBe(false);
    expect(shouldPrompt(m, "0.1.0", false, undefined)).toBe(false);
    expect(shouldPrompt(m, "2026.1115.140000", true, undefined)).toBe(false);
    expect(shouldPrompt(m, "2026.1115.140000", false, m.version)).toBe(false);
    expect(shouldPrompt(undefined, "2026.1115.140000", false, undefined)).toBe(false);
  });
});
