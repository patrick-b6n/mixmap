import { describe, expect, it } from "vitest";

import { calver, calverToSemver, nextReleaseVersion, parseCalver, semverToCalver } from "./calver";

describe("CalVer", () => {
  it("is YYYY.MM.DD.HHMM in UTC, without seconds", () => {
    expect(calver(new Date(Date.UTC(2026, 0, 5, 0, 30, 12)))).toBe("2026.01.05.0030");
    expect(calver(new Date(Date.UTC(2026, 10, 16, 13, 45)))).toBe("2026.11.16.1345");
    expect(calver(new Date(Date.UTC(2026, 11, 31, 23, 59, 59)))).toBe("2026.12.31.2359");
  });

  it("round-trips and rejects anything else", () => {
    expect(parseCalver("2026.11.16.1345")?.toISOString()).toBe("2026-11-16T13:45:00.000Z");
    expect(parseCalver("2026.02.30.1200")).toBeUndefined();
    expect(parseCalver("2026.11.16.2460")).toBeUndefined();
    expect(parseCalver("2026.1116.1345")).toBeUndefined();
    expect(parseCalver("0.0.0")).toBeUndefined();
  });

  it("converts to and from the SemVer the app carries", () => {
    expect(calverToSemver("2026.11.16.1345")).toBe("2026.1116.1345");
    expect(calverToSemver("2026.01.05.0030")).toBe("2026.105.30");
    expect(calverToSemver("2027.01.01.0000")).toBe("2027.101.0");
    expect(semverToCalver("2026.1116.1345")).toBe("2026.11.16.1345");
    expect(semverToCalver("2026.105.30")).toBe("2026.01.05.0030");
    expect(semverToCalver("0.0.0")).toBeUndefined();
    expect(semverToCalver("2026.1116.82126")).toBeUndefined();
    for (const v of ["2026.01.05.0030", "2026.12.31.2359", "2027.01.01.0000"]) {
      expect(semverToCalver(calverToSemver(v)!)).toBe(v);
    }
  });

  it("gives every release a higher version than the existing tags", () => {
    const now = new Date(Date.UTC(2026, 10, 16, 13, 45, 30));
    expect(nextReleaseVersion(now, []).version).toBe("2026.11.16.1345");
    // Old-format tags (seconds) count by their time.
    expect(nextReleaseVersion(now, ["v2026.1116.82126", "nightly", ""]).version).toBe(
      "2026.11.16.1345",
    );
    expect(nextReleaseVersion(now, ["v2026.1116.134520"]).version).toBe("2026.11.16.1346");
    // Same minute as the latest release, or a clock behind it: latest + 1 minute.
    expect(nextReleaseVersion(now, ["v2026.11.16.1345"]).version).toBe("2026.11.16.1346");
    expect(nextReleaseVersion(now, ["v2026.11.16.2359"]).version).toBe("2026.11.17.0000");
    expect(nextReleaseVersion(now, ["v2026.12.31.2359"]).version).toBe("2027.01.01.0000");
  });
});
