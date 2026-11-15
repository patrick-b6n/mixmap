import { describe, expect, it, vi } from "vitest";
import type { LibrarySource } from "../api";
import { setSetting, SETTINGS } from "./settings";
import { migrate } from "./schema";
import { startDatabase } from "./startup";
import { memoryDb } from "./testing";

describe("startDatabase", () => {
  it("migrates and leaves the automatic source alone", async () => {
    const db = memoryDb();
    const apply = vi.fn<(s: LibrarySource) => Promise<unknown>>(async () => undefined);
    await startDatabase(db, apply);
    expect(apply).not.toHaveBeenCalled();
    await setSetting(db, SETTINGS.librarySource, { kind: "auto" });
    await startDatabase(db, apply);
    expect(apply).not.toHaveBeenCalled();
  });

  it("re-applies a saved source", async () => {
    const db = memoryDb();
    await migrate(db);
    const source: LibrarySource = { kind: "xml", path: "C:\\x.xml" };
    await setSetting(db, SETTINGS.librarySource, source);
    const apply = vi.fn<(s: LibrarySource) => Promise<unknown>>(async () => undefined);
    await startDatabase(db, apply);
    expect(apply).toHaveBeenCalledWith(source);
  });
});
