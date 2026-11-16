import { describe, expect, it, vi } from "vitest";
import type { LibrarySource } from "../api";
import { getSetting, setSetting, SETTINGS } from "./settings";
import { restoreSettings } from "./startup";
import { testDb } from "./testing";

describe("restoreSettings", () => {
  it("leaves the automatic source alone", async () => {
    const db = await testDb();
    const apply = vi.fn<(s: LibrarySource) => Promise<unknown>>(async () => undefined);
    await restoreSettings(db, apply);
    await setSetting(db, SETTINGS.librarySource, { kind: "auto" });
    await restoreSettings(db, apply);
    expect(apply).not.toHaveBeenCalled();
  });

  it("re-applies a saved source", async () => {
    const db = await testDb();
    const source: LibrarySource = { kind: "xml", path: "C:\\x.xml" };
    await setSetting(db, SETTINGS.librarySource, source);
    const apply = vi.fn<(s: LibrarySource) => Promise<unknown>>(async () => undefined);
    await restoreSettings(db, apply);
    expect(apply).toHaveBeenCalledWith(source);
  });
});

describe("settings", () => {
  it("stores settings as JSON", async () => {
    const db = await testDb();
    expect(await getSetting(db, "x")).toBeUndefined();
    await setSetting(db, "x", { kind: "xml", path: "C:\\a.xml" });
    await setSetting(db, "x", { kind: "auto" });
    expect(await getSetting(db, "x")).toEqual({ kind: "auto" });
  });
});
