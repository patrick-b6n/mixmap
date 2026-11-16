import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { loadMigrations, parseMigrations } from "./bundled-migrations";
import journal from "./migrations/meta/_journal.json";

describe("loadMigrations", () => {
  it("bundles every journal entry in order", async () => {
    const migrations = await loadMigrations();
    expect(migrations.map((migration) => migration.tag)).toEqual(journal.entries.map((entry) => entry.tag));
  });

  it("splits the SQL at the statement breakpoints", async () => {
    const [init] = await loadMigrations();
    const file = readFileSync(new URL("migrations/0000_init.sql", import.meta.url), "utf8");
    expect(init?.statements).toHaveLength(file.split("--> statement-breakpoint").length);
    expect(init?.statements[0]).toMatch(/^CREATE TABLE `links`/);
    expect(init?.statements.join("\n")).not.toContain("statement-breakpoint");
  });
});

describe("parseMigrations", () => {
  const twoEntries = {
    entries: [
      { idx: 0, tag: "0000_a" },
      { idx: 1, tag: "0001_b" },
    ],
  };

  it("drops empty statements and hashes the SQL", async () => {
    const [a] = await parseMigrations(twoEntries, (tag) =>
      tag === "0000_a" ? "SELECT 1;\n--> statement-breakpoint\n\n" : "SELECT 2;",
    );
    expect(a?.statements).toEqual(["SELECT 1;"]);
    expect(a?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashes independently of line endings", async () => {
    const [lf] = await parseMigrations(twoEntries, () => "SELECT 1;\nSELECT 2;");
    const [crlf] = await parseMigrations(twoEntries, () => "SELECT 1;\r\nSELECT 2;");
    expect(crlf?.hash).toBe(lf?.hash);
  });

  it("gives different SQL different hashes", async () => {
    const [a, b] = await parseMigrations(twoEntries, (tag) => `SELECT '${tag}';`);
    expect(a?.hash).not.toBe(b?.hash);
  });

  it("fails if a file is missing", async () => {
    await expect(parseMigrations(twoEntries, (tag) => (tag === "0000_a" ? "SELECT 1;" : undefined))).rejects.toThrow(
      /0001_b\.sql is missing/,
    );
  });

  it("fails if the journal is not numbered consecutively", async () => {
    await expect(parseMigrations({ entries: [{ idx: 1, tag: "0001_b" }] }, () => "SELECT 1;")).rejects.toThrow(
      /expected 0/,
    );
  });
});
