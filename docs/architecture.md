# Architecture

mixmap is a Tauri v2 desktop app. The Rust crate in `src-tauri/` does the I/O a
WebView can't (rekordbox library, artwork, memory reader, network sync, self-update);
everything else runs in TypeScript in the WebView. The setup mirrors belegwerk-next.

## Layers

The code under `src/` is split into layers whose dependencies point one way. oxlint
enforces the boundaries (`no-restricted-imports`, [`.oxlintrc.json`](../.oxlintrc.json)).

```
src/routes ─┬──────────────────► src/app ──────────────┐
src/ui ─────┤                   (composition root)     │ wires
            │                        │                 ▼
            └──► src/business ◄──────┴────────── src/persistence
```

Arrows = "imports from". `src/app` imports from all layers; UI and routes get data
only through the services from `src/app`, never from `src/persistence`.

| Folder            | Contents                                                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `src/routes`      | TanStack Router routes (file based): `/` (main window) and `/overlay` (overlay window). The root route opens the database first.         |
| `src/ui`          | Components, hooks, styles; `src/ui/components/ui` holds the shadcn/ui components on Base UI. TanStack Query, Form and Table live here.   |
| `src/business`    | Domain logic (keys, matching, graph, merge/sync, filters, paths, …), the model types and the **ports** (`ports.ts`). No React, no Tauri. |
| `src/persistence` | mixmap.db: SQL client, single-connection queue, Drizzle schema and migrations, migrator, repositories implementing the ports.            |
| `src/app`         | Composition root: the Tauri backend (`backend.ts`, implements the `Backend` port), database opening, services, providers, query client.  |

Rules:

- **No JSX, no React, no Tauri, no UI text in `src/business`.** Platform access goes
  behind an interface in `business/ports.ts`; `src/app` implements it.
- **`src/persistence` runs in the WebView**: no `node:*` or drizzle-kit outside tests.
- **UI text** comes from Paraglide messages only ([i18n](i18n.md)).

## Composition root

`src/app/services.ts` creates the services of a window: the repositories
(`persistence/repositories`) on mixmap.db, the backend, and business services built on
both (backup, sync, restoring settings). `AppServicesProvider` (`app-services.tsx`)
opens the database once per window, shows a loading or error screen until then, and
provides the services; components use `useAppServices()`.

## Windows and routes

The frontend is a TanStack Start SPA: `pnpm build` prerenders the shell as
`dist/client/index.html`, which Tauri also serves for every other path. The main
window loads `/`, the overlay window (`src-tauri/tauri.conf.json`) `/overlay`. Each
window has its own JS, its own services and its own TanStack Query cache.

## Data loading

Reads are TanStack Query queries ([`src/ui/queries.ts`](../src/ui/queries.ts) has the
keys): the library and its status, links and tracks, graph nodes, matching, sync
status, version, now playing. Backend events (`library`, `now-playing`, `peers`, …)
update or invalidate them. Writes call the services and invalidate what they changed
(`invalidateMixmap`).

## Rust backend

The UI calls the backend through one Tauri command, `call(command, args)`, dispatched
by `App::call` (`src-tauri/src/app.rs`); events are Tauri events of the same name.
Artwork comes from the `artwork` URI scheme. The other commands (overlay hotkey,
window control, updater) are separate. All app commands are declared in the app
manifest (`src-tauri/build.rs`) and granted in
[`capabilities/default.json`](../src-tauri/capabilities/default.json); the database
plugin is limited to `execute` and `select`.

## Lint, format, TypeScript

- oxlint: correctness and suspicious as errors, React hooks rules, layer boundaries.
- oxfmt: 100 columns; generated files (`src/routeTree.gen.ts`, `src/paraglide`,
  migrations) are ignored.
- TypeScript is split like belegwerk-next: `tsconfig.app.json` (WebView code, no Node
  types), `tsconfig.node.json` (configs and `scripts/`), `tsconfig.test.json` (tests,
  with Node types).
