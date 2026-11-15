# MixMap — Specification

MixMap is a Windows desktop app for DJs. It reads the local **rekordbox** library and lets you build a **directed graph of transitions** between tracks (A → B = "I can mix A into B"). While mixing, a small overlay shows which tracks are linked to the ones currently loaded in rekordbox.

## Platform & architecture

- **Tauri 2 + React + TypeScript**, Rust backend. Windows only. **Dark theme only.**
- UI stack: **Tailwind CSS v4 + shadcn/ui** (theme tokens map the dark palette); **oxc** (oxlint, oxfmt) for linting and formatting; Vitest for tests.
- **TypeScript first, Rust only where necessary.** Rust is a thin I/O layer for what a browser can't do; all domain logic lives in TypeScript.
- Layout of the repo:
  - `crates/core` — I/O only: locating and decrypting rekordbox `master.db` and returning raw library data, file watching, artwork extraction and thumbnail cache, MixMap SQLite storage, network (mDNS, sync transport), memory reader for now-playing.
  - `crates/devserver` — small local HTTP server (axum) exposing the same API as the Tauri commands, for fast dev loops in a plain browser.
  - `ui/` — React (Vite) frontend **and all domain logic** (`ui/src/domain/`): keys and compatibility, portable track keys and matching, links/boards rules, export/import and merge/sync semantics, filters, pair import, path-finding. Talks to the backend through **one API adapter**: HTTP to the devserver in the browser, `invoke` in Tauri.
  - `src-tauri/` — added **late**: thin shell over `core`. Needed only for overlay window, global hotkey, updater and installer.
- Daily dev loop: `vite` + `cargo run -p devserver`, browser.

## Data

### rekordbox (source, read-only)
- rekordbox 7.x `master.db` (SQLCipher-encrypted SQLite), opened **strictly read-only**. MixMap never writes to rekordbox data.
- Location auto-detected via `%APPDATA%\Pioneer\rekordboxAgent\storage\options.json` (`db-path`), overridable in settings.
- Fallback: import a rekordbox **XML export**.
- File watcher on `master.db` → debounced automatic reload; manual **Refresh** button.
- Data shown: artwork, title, artist, album, genre, BPM, key (Camelot first + musical), rating, comment, length, playlists.

### Artwork
- rekordbox artwork if present, otherwise **embedded cover from the audio file** (ID3/FLAC/MP4 via `lofty`); thumbnails cached; placeholder otherwise.

### MixMap's own data
- `%APPDATA%\mixmap\mixmap.db` (SQLite): links, boards, node positions, manual track matches, tombstones, settings.
  - Rust exposes it only as a generic bridge (`db_query`, `db_execute` = statements in one transaction). Schema, migrations (`PRAGMA user_version`) and all queries live in TypeScript (`ui/src/db`), tested against `node:sqlite`.
  - Rows have natural cross-machine identities: tracks by portable key, links by (from, to), board nodes by (board, track); boards use UUIDs. Timestamps are milliseconds since the epoch (`created_at`/`updated_at` on every row); deleting a synced row records a tombstone (`kind`, `id`, `deleted_at`). Settings with a `local.` prefix are machine-specific and never synced.
  - The devserver only answers requests addressed to localhost (Host check), since it exposes raw SQL.
- `%APPDATA%\mixmap\artwork\` — thumbnail cache. `%APPDATA%\mixmap\backups\` — automatic backups.

### Track identity
- rekordbox IDs and file paths differ between machines, so every linked track is stored with a **portable key**: normalized artist + title + duration (rounded to seconds). The local rekordbox ID is only a cache.
- On import / sync / library rebuild, tracks are matched by key. Unmatched or ambiguous ones land in an **"Unmatched tracks"** list for one-time manual mapping (remembered).
- Tracks removed from rekordbox stay in the graph, marked **missing**.

## Links & boards

- **Link**: directed A → B, **global** (exists once). Optional **comment**, **1–5 rating**, free **tags**. At most one link per direction per pair.
- **Boards**: named tabs (e.g. "Peak-time techno", "Warm-up"), each with its own set of tracks and positions. A link shows on every board that contains both endpoints. A track can be on several boards; a board can contain multiple disconnected clusters.
- **Canvas interactions**:
  - Drag track from table **onto a node** → link node → track (**Alt** = reverse). Track is added to the board if needed. No popup.
  - Drag track from table **onto empty canvas** → add node, no link.
  - Dragging an existing node **only moves it**, never links.
  - Drag from a node's **right handle** to another node → link.
  - **Click a link** → link editor in the right panel (comment, rating, tags, delete).
  - Delete link: select + Delete / context menu → Remove, with **Undo** (Ctrl+Z + toast), no confirm dialog.
  - "Remove from board" keeps links. "Delete all links of this track" requires confirmation showing the count.
- **Import pairs** from a rekordbox playlist or history: back-to-back pairs become links, with a preview before saving. Manual action only.

## Main window

- Left: collapsible **playlist tree**.
- Center: **graph on top (2/3 height)**, **track table below (1/3)**, draggable remembered splitter. Filter bar above the graph.
- Right: collapsible **details panel** (selected track info + its in/out links) / **link editor** (selected link).
- Graph: **React Flow (xyflow)** + **ELK** auto-layout on demand; manual positions persisted; minimap, zoom, pan. Node cards show artwork, title, artist, BPM, key, link count. Edges show a comment icon; thickness by rating.
- Track table: virtualized, configurable/resizable/sortable columns incl. link count; own search + playlist filter.
- Selection: clicking a table row only **highlights** the node in the graph (no pan/zoom). Double-click or **Ctrl+L** = locate in graph. Clicking a graph node selects and scrolls the table.
- **Graph filters** (never affect the table): name, artist, genre, BPM range, key, rating, comment text, **"compatible with selected"** (Camelot same / ±1 / relative major-minor, BPM tolerance default ±6 %, optional half/double tempo). Non-matching nodes **dimmed**, toggle to **hide**.

## Transfer & maintenance

- **Export/import** `.mixmap.json` (links, boards, positions, manual matches, timestamps). Import = **merge** (last-write-wins per item) by default, or **replace**.
  - Format (`format: "mixmap"`, `version: 1`): tracks (portable key, artist, title, duration), links, boards, board nodes, manual matches, tombstones and non-`local.` settings, each with its timestamps. Machine-local caches (rekordbox id, missing flag) are not exported. A manual match also carries `targetKey`, the portable key of the rekordbox track it points to, so another machine can resolve it instead of trusting a foreign rekordbox id.
  - Merge rules (import and sync share them, `ui/src/domain/merge.ts`): per item the later of row (`updated_at`) and tombstone (`deleted_at`) wins; on a tie a deletion wins, then the larger row, so both sides of a sync agree. A deleted board takes its nodes with it; links and nodes whose track or board doesn't survive are dropped; tracks still referenced are never deleted. All changes apply in one transaction.
  - Replace wipes all synced data (machine-local settings stay) after writing an automatic backup to `backups\`, then loads the file as is.
- **Network sync** with another MixMap instance: mDNS discovery, first-time pairing with a 6-digit code, manual **"Sync now"** two-way merge, last-write-wins, **tombstones** so deletions propagate.
  - Each instance has an identity in `%APPDATA%\mixmap\device.json` (random id, name = computer name) and advertises `_mixmap._tcp.local.` (TXT: `id`, `name`, `protocol`) for a separate LAN listener on an OS-assigned port. The LAN listener serves only `/sync/*` endpoints; the local API stays on localhost. Windows asks once to allow it through the firewall.
  - Dev: `MIXMAP_APP_DIR` and `MIXMAP_DEV_ADDR` start a second devserver instance (own data, own port) for sync tests on one machine.
- **Reset database**: Settings → type `RESET` → automatic backup export first. Only affects MixMap data. Machine-local settings (e.g. the library source) stay, and no tombstones are written: a reset never deletes anything on a sync peer.

## Live overlay

- Small always-on-top, frameless, draggable window; adjustable opacity; click-through toggle; global show/hide hotkey (e.g. Ctrl+Alt+M); remembers position/size; can run without the main window. **Read-only.**
- One column per active deck, master highlighted; outgoing links with comment, rating, BPM, key; marks a linked track already loaded on another deck.
- **Now-playing detection**, in order:
  1. Spike: does rekordbox write history to `master.db` live? If yes → use it (version-independent).
  2. Otherwise: own **memory reader** with a **calibration wizard** (load known tracks on deck 1/2, scan memory for the title, derive pointer chains, save per rekordbox version).
  3. **Manual mode** (type-ahead to set the current track) always available as fallback.
- rkbx_link is **not** used (newer rekordbox versions require a paid licence).

## Distribution

- Tauri **NSIS** installer, unsigned (SmartScreen warning on first run).
- **Auto-update**: every push to `main` → GitHub Actions builds, signs updater artifacts (Tauri updater key as repo secret), publishes a GitHub Release with `latest.json`. App checks on startup and offers "install & restart"; **never auto-installs**, and **no prompt while the overlay is active**.
- **Versioning: CalVer** `YYYY.MMDD.HHMMSS` in UTC as semver-compatible numbers (leading zeros drop, e.g. `2026.105.3012` for 5 Jan 00:30:12). Release title shows `2026-11-14 15:30:12 UTC`.
- Requires `gh auth refresh -s workflow` once before workflows can be pushed.

## Testing

- Rust unit tests: rekordbox reader (against a local snapshot in `fixtures/`, git-ignored), storage, watcher, artwork.
- Vitest: domain logic — keys and compatibility, filters, graph operations, merge/sync semantics, portable-key matching.
- Manual verification in the browser against the devserver. No E2E suite for now.

## Milestones

1. Library browser
2. Links, boards, graph & filters
3. Transfer & maintenance (export/import, sync, reset)
4. Live overlay (manual mode first, then automatic detection)
5. Tauri desktop app (shell, overlay window, hotkey, installer)
6. Releases & auto-update
7. v1.1 — path-finding (shortest transition path A → B)
