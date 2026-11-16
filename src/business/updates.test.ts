import { describe, expect, it } from "vitest";
import { shouldPrompt, type UpdateCheck } from "./updates";

const check: UpdateCheck = {
  currentVersion: "2026.1115.140000",
  latestVersion: "2026.1115.150000",
  releaseUrl: "https://github.com/x/y/releases/tag/v2026.1115.150000",
  title: "2026-11-15 15:00:00 UTC",
  updateAvailable: true,
};

describe("updates", () => {
  it("offers only available updates, not while the overlay is shown, not after Later", () => {
    expect(shouldPrompt(check, false, undefined)).toBe(true);
    expect(shouldPrompt({ ...check, updateAvailable: false }, false, undefined)).toBe(false);
    expect(shouldPrompt(check, true, undefined)).toBe(false);
    expect(shouldPrompt(check, false, check.latestVersion ?? undefined)).toBe(false);
    expect(shouldPrompt(undefined, false, undefined)).toBe(false);
  });
});
