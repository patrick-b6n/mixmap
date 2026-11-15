// In-memory SQLite (node:sqlite) implementing `Db`, for Vitest. Mirrors the backend:
// statements run in one transaction; booleans → 0/1; arrays/objects → JSON text.
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { Db, ExecResult, SqlValue } from "./db";

function toSql(v: SqlValue | undefined): SQLInputValue {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}

export function memoryDb(): Db & { raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  return {
    async execute(statements) {
      const results: ExecResult[] = [];
      raw.exec("BEGIN");
      try {
        for (const s of statements) {
          const r = raw.prepare(s.sql).run(...(s.params ?? []).map(toSql));
          results.push({ changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) });
        }
        raw.exec("COMMIT");
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
      return results;
    },
    async query<T>(sql: string, params: SqlValue[] = []) {
      return raw.prepare(sql).all(...params.map(toSql)) as T[];
    },
    raw,
  };
}
