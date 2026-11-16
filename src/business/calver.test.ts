import { describe, expect, it } from "vitest";
import { calver, isNewer, nextReleaseVersion, parseCalver, releaseTitle } from "./calver";

describe("CalVer", () => {
  it("drops leading zeros", () => {
    const d = new Date(Date.UTC(2026, 0, 5, 0, 30, 12));
    expect(calver(d)).toBe("2026.105.3012");
    expect(releaseTitle(d)).toBe("2026-01-05 00:30:12 UTC");
  });

  it("handles the extremes of a day", () => {
    expect(calver(new Date(Date.UTC(2026, 10, 14, 15, 30, 12)))).toBe("2026.1114.153012");
    expect(calver(new Date(Date.UTC(2026, 11, 31, 23, 59, 59)))).toBe("2026.1231.235959");
    expect(calver(new Date(Date.UTC(2027, 0, 1, 0, 0, 0)))).toBe("2027.101.0");
  });

  it("is semver-compatible and round-trips", () => {
    for (const d of [
      Date.UTC(2026, 0, 5, 0, 30, 12),
      Date.UTC(2027, 0, 1),
      Date.UTC(2026, 10, 14, 9, 5, 7),
    ]) {
      const v = calver(new Date(d));
      expect(v).toMatch(/^\d+\.\d+\.\d+$/);
      expect(v.split(".").every((p) => p === "0" || !p.startsWith("0"))).toBe(true);
      expect(parseCalver(v)?.getTime()).toBe(d);
    }
  });

  it("orders builds by time, never updates dev builds", () => {
    expect(isNewer("2026.1115.10", "2026.1115.9")).toBe(true);
    expect(isNewer("2026.1115.100000", "2026.1115.95959")).toBe(true);
    expect(isNewer("2026.101.0", "2025.1231.235959")).toBe(true);
    expect(isNewer("2026.1115.9", "2026.1115.9")).toBe(false);
    expect(isNewer("2026.1115.9", "0.1.0")).toBe(false);
    expect(isNewer("garbage", "2026.1115.9")).toBe(false);
    expect(parseCalver("2026.230.0")).toBeUndefined();
    expect(parseCalver("2026.1115.250000")).toBeUndefined();
  });

  it("gives every release a higher version than the existing tags", () => {
    const now = new Date(Date.UTC(2026, 10, 16, 8, 21, 26));
    expect(nextReleaseVersion(now, []).version).toBe("2026.1116.82126");
    expect(nextReleaseVersion(now, ["v2026.1116.81227", "nightly", ""]).version).toBe(
      "2026.1116.82126",
    );
    // Same second as the latest release, or a clock behind it: latest + 1 s.
    expect(nextReleaseVersion(now, ["v2026.1116.82126"]).version).toBe("2026.1116.82127");
    expect(nextReleaseVersion(now, ["v2026.1116.235959"]).version).toBe("2026.1117.0");
    expect(nextReleaseVersion(now, ["v2026.1231.235959"]).date.toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });
});
