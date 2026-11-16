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

- **Your library, instantly**: mixmap picks up your rekordbox collection on its own and stays in sync as it changes. Your rekordbox library is never touched.
- **Map your mixes**: drag tracks onto the canvas and connect the ones that blend well. Add notes, ratings and tags to remember why a transition works.
- **Boards for every vibe**: keep separate maps for warm-up, peak time or that one special set, all sharing what you've already learned.
- **Find the perfect next track**: filter by genre, tempo, key or rating, or show only the tracks that harmonically fit your current pick.
- **Get from A to B**: pick two tracks and mixmap shows you the smoothest route between them.
- **Learn from your sets**: turn a played set or playlist into transitions with one click.
- **Live on the decks**: a compact overlay sits on top of rekordbox and shows where you can go next with the tracks you have loaded.
- **Take it anywhere**: your maps follow you to every computer, with backups and sync between machines on the same network.
- **Just run it**: a single file, no installer, and it keeps itself up to date.

## Install

Download `mixmap.exe` from the [latest release](https://github.com/patrick-b6n/mixmap/releases/latest) and run it. It's unsigned, so Windows SmartScreen will warn on first start. Requires Windows 10/11 (WebView2). Data lives in `%APPDATA%\mixmap`.

## Development

Requirements: Rust (stable), Node.js 20+. See [docs/SPEC.md](docs/SPEC.md) for the design.

```bash
cargo run -p devserver        # API on http://127.0.0.1:5174
npm --prefix ui install
npm --prefix ui run dev       # UI on http://localhost:5173 (proxies /api to the devserver)
```

Checks: `cargo test`, `cargo clippy -- -D warnings`, `npm --prefix ui test`, `npm --prefix ui run lint` (oxlint), `npm --prefix ui run format:check` (oxfmt; `format` to fix).

## License

MIT
