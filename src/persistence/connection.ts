import type { ExecuteResult, SqlClient, SqlRow, SqlValue } from "./sql-client";

/**
 * Serializes all access to the single database connection.
 *
 * The Tauri host opens the database with exactly one connection
 * (src-tauri/src/lib.rs), so every call lands on the same connection – a
 * prerequisite for transactions and `PRAGMA`s spread over several calls.
 * What remains is interleaving: while one flow is between `BEGIN` and
 * `COMMIT`, a query from another flow would end up inside its transaction.
 * Hence every call queues here, and {@link exclusive} hands one flow the
 * connection for a whole sequence of statements.
 *
 * mixmap has two windows (main and overlay), each with its own JS, sharing
 * that one connection. With {@link SqlConnectionOptions.lockName} every
 * exclusive section also holds a Web Lock of that name, which all windows of
 * the app share (same origin, same WebView2 profile), so the sections of both
 * windows never interleave either.
 *
 * Never use the connection itself inside {@link exclusive} or
 * {@link transaction} – that call would wait for the running callback and
 * deadlock. Use the client passed to the callback. (For repositories: inside
 * `UnitOfWork.run` only the repositories passed to the callback.) As a hint,
 * a call that waits longer than {@link SqlConnectionOptions.slowWaitMs} is
 * reported via `console.error`.
 */
export class SqlConnection implements SqlClient {
  readonly #client: SqlClient;
  readonly #slowWaitMs: number;
  readonly #onSlowWait: (waitedMs: number) => void;
  #queue: Promise<unknown> = Promise.resolve();
  /** Calls started but not yet settled (at most one runs at a time). */
  #pending = 0;

  readonly #lockName: string | undefined;

  constructor(client: SqlClient, options: SqlConnectionOptions = {}) {
    this.#client = client;
    this.#slowWaitMs = options.slowWaitMs ?? 10_000;
    this.#onSlowWait = options.onSlowWait ?? reportSlowWait;
    this.#lockName = options.lockName;
  }

  /** Runs `task` while holding the cross-window lock (if configured and supported). */
  #withWindowLock<T>(task: () => Promise<T>): Promise<T> {
    const locks = globalThis.navigator?.locks;
    if (this.#lockName === undefined || !locks) return task();
    return locks.request(this.#lockName, task);
  }

  execute(sql: string, params?: readonly SqlValue[]): Promise<ExecuteResult> {
    return this.exclusive((client) => client.execute(sql, params));
  }

  select(sql: string, params?: readonly SqlValue[]): Promise<SqlRow[]> {
    return this.exclusive((client) => client.select(sql, params));
  }

  /**
   * Runs `fn` with sole access to the connection. The client passed to `fn`
   * must not be used after its promise settled (it throws then).
   */
  exclusive<T>(fn: (client: SqlClient) => Promise<T>): Promise<T> {
    // Watchdog: only if the call has to queue behind another one.
    const watchdog =
      this.#pending > 0 ? setTimeout(() => this.#onSlowWait(this.#slowWaitMs), this.#slowWaitMs) : undefined;
    this.#pending += 1;
    const run = this.#queue.then(() =>
      this.#withWindowLock(async () => {
        clearTimeout(watchdog);
        const scoped = scopedClient(this.#client);
        try {
          return await fn(scoped.client);
        } finally {
          scoped.close();
          this.#pending -= 1;
        }
      }),
    );
    this.#queue = run.catch(() => undefined);
    return run;
  }

  /**
   * Runs `fn` in a transaction: `COMMIT` if it resolves, `ROLLBACK` if it
   * rejects (the original error is rethrown).
   */
  transaction<T>(fn: (client: SqlClient) => Promise<T>): Promise<T> {
    return this.exclusive(async (client) => {
      await begin(client);
      let result: T;
      try {
        result = await fn(client);
      } catch (error) {
        await rollbackQuietly(client);
        throw error;
      }
      try {
        await client.execute("COMMIT");
      } catch (error) {
        await rollbackQuietly(client);
        throw error;
      }
      return result;
    });
  }
}

export interface SqlConnectionOptions {
  /** A call that waits longer than this for the connection is reported (default 10 s). */
  slowWaitMs?: number;
  /** Reports a slow wait; default `console.error` with a hint at the deadlock rule. */
  onSlowWait?: (waitedMs: number) => void;
  /**
   * Name of a Web Lock held for every exclusive section, shared by all windows
   * of the app; without it, calls are only serialized within this window.
   */
  lockName?: string;
}

/**
 * `BEGIN IMMEDIATE`. A window closed in the middle of a transaction leaves it
 * open on the shared connection; nobody else can be inside it (we hold the
 * lock), so roll it back and begin again.
 */
export async function begin(client: SqlClient): Promise<void> {
  try {
    await client.execute("BEGIN IMMEDIATE");
  } catch (error) {
    if (!/within a transaction/i.test(String(error))) throw error;
    await client.execute("ROLLBACK");
    await client.execute("BEGIN IMMEDIATE");
  }
}

function reportSlowWait(waitedMs: number) {
  console.error(
    `A database call has been waiting for more than ${waitedMs / 1000} s. If it was issued ` +
      "inside Database.transaction / UnitOfWork.run with the outer db or repositories " +
      "(instead of the tx / the repositories passed to the callback), it deadlocks.",
  );
}

/**
 * Rolls back, ignoring a failure of the rollback itself (e.g. because SQLite
 * already rolled back after the error), so the original error surfaces.
 */
export async function rollbackQuietly(client: SqlClient): Promise<void> {
  try {
    await client.execute("ROLLBACK");
  } catch {
    // The caller rethrows the error that caused the rollback.
  }
}

function scopedClient(client: SqlClient) {
  let closed = false;
  const check = () => {
    if (closed) {
      throw new Error("SQL client used after its exclusive section ended");
    }
  };
  return {
    client: {
      execute: async (sql, params) => {
        check();
        return client.execute(sql, params);
      },
      select: async (sql, params) => {
        check();
        return client.select(sql, params);
      },
    } satisfies SqlClient,
    close: () => {
      closed = true;
    },
  };
}
