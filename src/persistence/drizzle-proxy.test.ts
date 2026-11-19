import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { describe, expect, it } from "vitest";

import { dbError } from "@/persistence/__tests__/test-db";
import { createBatchCallback, createProxyCallback, rowToArray, toSqlValues } from "./drizzle-proxy";
import type { ExecuteResult, SqlClient, SqlRow, SqlValue } from "./sql-client";

type Call = { kind: "execute" | "select"; sql: string; params: readonly SqlValue[] };

/** Fake plugin: records calls, answers `select` with the given rows. */
function fakeClient(rows: SqlRow[] = [], result: ExecuteResult = { rowsAffected: 1 }) {
  const calls: Call[] = [];
  const client: SqlClient = {
    execute: async (query, params = []) => {
      calls.push({ kind: "execute", sql: query, params });
      return result;
    },
    select: async (query, params = []) => {
      calls.push({ kind: "select", sql: query, params });
      return rows;
    },
  };
  return { calls, client };
}

const items = sqliteTable("items", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  active: integer("active", { mode: "boolean" }).notNull(),
});

describe("createProxyCallback", () => {
  it("maps run to execute and passes its result through", async () => {
    const { calls, client } = fakeClient([], { rowsAffected: 2, lastInsertId: 7 });
    const result = await createProxyCallback(client)("DELETE FROM items WHERE id = ?", [1], "run");
    expect(calls).toEqual([
      { kind: "execute", sql: "DELETE FROM items WHERE id = ?", params: [1] },
    ]);
    expect(result).toEqual({ rows: [], rowsAffected: 2, lastInsertId: 7 });
  });

  it.each(["all", "values"] as const)("maps %s to select with rows as arrays", async (method) => {
    const { calls, client } = fakeClient([
      { id: 1, name: "a" },
      { id: 2, name: "b" },
    ]);
    const result = await createProxyCallback(client)("SELECT id, name FROM items", [], method);
    expect(calls).toEqual([{ kind: "select", sql: "SELECT id, name FROM items", params: [] }]);
    expect(result).toEqual({
      rows: [
        [1, "a"],
        [2, "b"],
      ],
    });
  });

  it("maps get to the first row as array", async () => {
    const { client } = fakeClient([{ id: 1, name: "a" }]);
    await expect(createProxyCallback(client)("SELECT 1", [], "get")).resolves.toEqual({
      rows: [1, "a"],
    });
  });

  it("maps get without rows to undefined", async () => {
    const { client } = fakeClient([]);
    await expect(createProxyCallback(client)("SELECT 1", [], "get")).resolves.toEqual({
      rows: undefined,
    });
  });

  it.each([
    "BEGIN",
    "begin deferred",
    " commit",
    "ROLLBACK",
    "savepoint sp0",
    "release sp0",
    "END",
  ])("rejects the transaction statement %j", async (statement) => {
    const { calls, client } = fakeClient();
    await expect(createProxyCallback(client)(statement, [], "run")).rejects.toThrow(
      /Database\.transaction/,
    );
    expect(calls).toEqual([]);
  });

  it("does not mistake other statements for transaction statements", async () => {
    const { calls, client } = fakeClient();
    await createProxyCallback(client)("UPDATE items SET name = 'begin'", [], "run");
    expect(calls).toHaveLength(1);
  });
});

describe("with Drizzle", () => {
  it("maps selected columns by position and binds booleans as 1/0", async () => {
    const { calls, client } = fakeClient([{ name: "Miete", id: 3, active: 1 }]);
    const db = drizzle(createProxyCallback(client));
    const rows = await db
      .select({ name: items.name, id: items.id, active: items.active })
      .from(items)
      .where(sql`${items.active} = ${true}`);
    expect(rows).toEqual([{ name: "Miete", id: 3, active: true }]);
    expect(calls[0]?.sql).toBe(
      'select "name", "id", "active" from "items" where "items"."active" = ?',
    );
    expect(calls[0]?.params).toEqual([1]);
  });

  it("returns undefined from get() without rows", async () => {
    const db = drizzle(createProxyCallback(fakeClient([]).client));
    await expect(db.select().from(items).get()).resolves.toBeUndefined();
  });

  it("rejects db.transaction()", async () => {
    const db = drizzle(createProxyCallback(fakeClient().client));
    expect(await dbError(db.transaction(async () => undefined))).toMatch(/Database\.transaction/);
  });
});

describe("createBatchCallback", () => {
  it("runs the queries in order", async () => {
    const { calls, client } = fakeClient([{ id: 1 }]);
    const batch = createBatchCallback(createProxyCallback(client));
    const results = await batch([
      { sql: "INSERT INTO items DEFAULT VALUES", params: [], method: "run" },
      { sql: "SELECT id FROM items", params: [], method: "all" },
    ]);
    expect(calls.map((call) => call.kind)).toEqual(["execute", "select"]);
    expect(results).toEqual([{ rows: [], rowsAffected: 1 }, { rows: [[1]] }]);
  });
});

describe("toSqlValues", () => {
  it("passes strings, numbers and null through", () => {
    expect(toSqlValues(["a", 1, 1.5, -2, null])).toEqual(["a", 1, 1.5, -2, null]);
  });

  it("maps booleans to 1/0 and undefined to null", () => {
    expect(toSqlValues([true, false, undefined])).toEqual([1, 0, null]);
  });

  it.each([
    ["bigint", 1n],
    ["object", { a: 1 }],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["bytes", new Uint8Array([1])],
  ])("rejects %s", (_, value) => {
    expect(() => toSqlValues([value])).toThrow(TypeError);
  });
});

describe("rowToArray", () => {
  it("keeps the column order of the row object", () => {
    expect(rowToArray({ b: 1, a: 2, c: 3 })).toEqual([1, 2, 3]);
  });

  it("rejects integer-like column names next to others (JS reorders them)", () => {
    expect(() => rowToArray({ name: "a", "1": 1 })).toThrow(/must not be integers/);
  });

  it("accepts a single integer-like column", () => {
    expect(rowToArray({ "1": 1 })).toEqual([1]);
  });
});
