# Data model

mixmap's own data lives in one SQLite file, `mixmap.db` in `%APPDATA%\mixmap`
(debug builds: `.dev-data/` in the repository, see `src-tauri/src/paths.rs`). The
rekordbox library is only read, never written.

## Tables

The schema is [`src/persistence/schema.ts`](../src/persistence/schema.ts) (Drizzle):

| Table            | Contents                                                                  |
| ---------------- | ------------------------------------------------------------------------- |
| `tracks`         | mixmap's tracks by portable key; `rekordbox_id`/`missing` are local cache |
| `links`          | directed transitions (from, to): comment, rating 1–5, tags (JSON)         |
| `nodes`          | cards on the graph and their positions                                    |
| `manual_matches` | portable key → this machine's rekordbox id                                |
| `tombstones`     | deleted synced rows (kind, id, deleted_at), so deletions sync             |
| `settings`       | JSON values; keys starting with `local.` are machine-local                |

## Migrations

- After changing the schema run `pnpm db:generate`; drizzle-kit writes a migration to
  `src/persistence/migrations/`. **Never edit a migration that has been released.**
- CI checks that the schema and the committed migrations match (`pnpm db:generate`
  must not create a new one).
- The app applies pending migrations at startup with its own migrator
  (`migrator.ts`): all in one transaction under `PRAGMA foreign_keys = OFF`, then a
  `foreign_key_check`. Applied migrations are recorded in `__migrations` with a
  SHA-256 of their SQL; the start fails if one was changed, is unknown (database from
  a newer app) or out of order.

### Databases from before Drizzle

Older mixmap versions tracked their schema in `PRAGMA user_version` (1 = boards,
2 = one graph). `legacy.ts` adopts such a database before migrating: version 1 is
backed up (`backups/backup-before-upgrade-….mixmap.json`) and upgraded to version 2
as before, then `0000_init` — exactly the version-2 schema — is recorded as applied.
A database with a higher `user_version` is refused.

## Connection

- **One connection.** The Tauri host opens mixmap.db with a pool of exactly one
  connection (WAL, foreign keys on, `busy_timeout`) and registers it with
  `tauri-plugin-sql` (`src-tauri/src/lib.rs`). The UI uses `Database.get`; the
  capability allows only `sql:allow-execute` and `sql:allow-select`.
- **Serialized in JS.** `SqlConnection` (`connection.ts`) queues all calls;
  `exclusive(fn)` gives one flow the connection for a sequence of statements,
  `transaction(fn)` wraps it in `BEGIN IMMEDIATE` … `COMMIT`/`ROLLBACK`.
- **Two windows.** Main and overlay window share the connection. Every exclusive
  section also holds the Web Lock `sqlite:mixmap.db`, which both windows share (same
  origin, same WebView2 profile), so their transactions never interleave. A
  transaction left open by a closed window is rolled back by the next `BEGIN`.
- **Values.** Booleans are bound as 0/1, arrays and objects as JSON text
  (`sql-db.ts`); the plugin binds numbers as REAL, which SQLite stores back losslessly
  in INTEGER columns.

## Access

- Drizzle (`sqlite-proxy`, `database.ts`) for the schema and typed queries; never
  `db.transaction()` (rejected), use `Database.transaction`.
- The repositories (`persistence/repositories`) use raw SQL through `SqlDb`
  (`sql-db.ts`): statements in one transaction, rows by column name. They implement
  the ports in `business/ports.ts`.
- The Rust host reads the overlay hotkey setting directly from the pool at startup.

## Sync format

Export/import, backups and network sync use the `.mixmap.json` format
(`business/exchange.ts`): everything that syncs, keyed by portable track key, with
timestamps and tombstones; merge rules are in `business/merge.ts`.
