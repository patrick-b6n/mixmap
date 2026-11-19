import { describe, expect, it, vi } from "vitest";
import type { LibrarySource } from "@/business/model";
import { getSetting, setSetting } from "@/persistence/repositories/settings";
import { SETTINGS } from "@/business/settings";
import { restoreSettings } from "@/business/startup";
import { testDb } from "@/persistence/__tests__/repositories";
import { createRepositories } from "@/persistence/repositories";

describe("restoreSettings", () => {
  it("leaves the automatic source alone", async () => {
    const db = await testDb();
    const apply = vi.fn<(s: LibrarySource) => Promise<unknown>>(async () => undefined);
    await restoreSettings(createRepositories(db).settings, apply);
    await setSetting(db, SETTINGS.librarySource, { kind: "auto" });
    await restoreSettings(createRepositories(db).settings, apply);
    expect(apply).not.toHaveBeenCalled();
  });

  it("re-applies a saved source", async () => {
    const db = await testDb();
    const source: LibrarySource = { kind: "xml", path: "C:\\x.xml" };
    await setSetting(db, SETTINGS.librarySource, source);
    const apply = vi.fn<(s: LibrarySource) => Promise<unknown>>(async () => undefined);
    await restoreSettings(createRepositories(db).settings, apply);
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
