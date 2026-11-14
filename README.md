# MixMap

A transition map for rekordbox DJs. MixMap reads your local rekordbox library, lets you link tracks into a directed graph of transitions ("A mixes into B"), and shows the linked tracks for whatever is loaded on your decks in a small always-on-top overlay.

Status: early development. See [docs/SPEC.md](docs/SPEC.md) for the design and the GitHub milestones for progress.

## Development

Requirements: Rust (stable), Node.js 20+.

```bash
cargo run -p devserver        # API on http://127.0.0.1:5174
npm --prefix ui install
npm --prefix ui run dev       # UI on http://localhost:5173 (proxies /api to the devserver)
```

Checks: `cargo test`, `cargo clippy -- -D warnings`, `npm --prefix ui test`.

## License

MIT
