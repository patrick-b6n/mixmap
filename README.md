> [!WARNING]
> **100% vibe coded, use at your own risk.**

<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" alt="mixmap logo" width="128" height="128" />
</p>

<h1 align="center">mixmap</h1>

<p align="center">A transition map for rekordbox DJs.</p>

mixmap reads your local rekordbox library, lets you link tracks into a directed graph of transitions ("A mixes into B"), and shows the linked tracks for whatever is loaded on your decks in a small always-on-top overlay.

![mixmap screenshot (track names and artwork anonymized)](docs/screenshot.png)

<sub>Track names, artists and artwork in the screenshot are anonymized.</sub>

## Features

- **Your library, instantly**: mixmap reads your rekordbox collection and stays in sync as it changes.
- **Map your mixes**: drag tracks onto the canvas and remember what mixes well. Add notes, ratings and tags to recall why a transition works.
- **Find the perfect next track**: filter by genre, tempo, key or rating, or show only the tracks that harmonically fit your current pick.
- **Get from A to B**: pick two tracks and mixmap shows you the smoothest route between them.
- **Learn from your sets**: merge a played set or playlist into the map.
- **Live on the decks**: a compact overlay sits on top of rekordbox and shows where you can go next with the tracks you have loaded.
- **Take it anywhere**: your maps follow you to every computer, with backups and sync between machines on the same network.
- **Just run it**: a single file, no installer, and it keeps itself up to date.

## Install

Download `mixmap.exe` from the [latest release](https://github.com/patrick-b6n/mixmap/releases/latest) and run it. It's unsigned, so Windows SmartScreen will warn on first start. Requires Windows 10/11 (WebView2). Data lives in `%APPDATA%\mixmap`.

## Development

Requirements: Windows 10/11, Node.js 26+, pnpm 12 (version pinned in `package.json`, e.g. via `corepack enable`), Rust stable (1.90+, MSVC) and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/#windows).

```bash
pnpm install
pnpm tauri dev    # Vite on port 1420 and the desktop app; data in .dev-data/
```

The UI only runs inside the desktop app. `pnpm verify` runs every check CI runs (format, lint incl. layer boundaries, typecheck, tests, cargo fmt/clippy/test); `pnpm db:generate` creates a migration after a schema change.

Docs: [Spec](docs/SPEC.md) · [Architecture](docs/architecture.md) · [Data model](docs/data-model.md) · [Release](docs/release.md) · [Testing](docs/testing.md) · [i18n](docs/i18n.md)

## License

MIT
