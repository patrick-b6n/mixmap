# Testing

`pnpm verify` runs what CI runs: `format:check`, `lint` (incl. layer boundaries),
`typecheck`, `test` (Vitest), `rust:check` (`cargo fmt --check`, `cargo clippy -D
warnings`) and `rust:test` (`cargo test`).

## Vitest

- Tests sit next to the code as `*.test.ts`; test-only helpers live in `__tests__/`
  folders (excluded from the app build, checked by `tsconfig.test.json`).
- Tests run in Node, in the time zone `Pacific/Pago_Pago` (UTC−11): code that formats
  in local time by accident fails instead of passing on UTC CI runners.
- **Business** tests are plain unit tests; fixtures in `business/__tests__/fixtures.ts`.
- **Persistence** tests run against an in-memory `node:sqlite` database opened
  through the app's own path (`persistence/__tests__/test-db.ts`: legacy adoption,
  migrator, Drizzle proxy); only the Tauri plugin is replaced. `testDb()` /
  `testRepositories()` give a fresh database per test.
- **Integration** tests of business services on real repositories (sync, startup)
  live in `src/app`.

## Rust

`cargo test --manifest-path src-tauri/Cargo.toml`. The rekordbox reader tests use a
local snapshot in `fixtures/` (git-ignored) when present. The mDNS discovery test
needs multicast and skips itself on CI (`CI` is set).

## In the app

`pnpm tauri dev` runs the desktop app against `.dev-data/`. There is no E2E suite;
the UI only runs inside the desktop app.
