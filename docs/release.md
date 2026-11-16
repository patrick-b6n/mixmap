# Release

mixmap ships as a **single portable `mixmap.exe`**: no installer, no code signing.
**Every push to `main` publishes a GitHub release**, and the app updates itself from it.

## Versions

CalVer from the build time in UTC, as semver-compatible numbers:
`YYYY.MMDD.HHMMSS` without leading zeros (`2026.105.3012` = 5 Jan, 00:30:12 UTC). Tags
are `v<version>`, release titles `2026-01-05 00:30:12 UTC`.

Nobody maintains the version by hand: `package.json` holds the placeholder `0.0.0`
(development builds never offer updates), `tauri.conf.json` reads the version from
`package.json`, and the version in `src-tauri/Cargo.toml` is unused.

## Publishing

`.github/workflows/release.yml` runs on every push to `main` (and by hand, on `main`
only):

1. Skip unless the commit is still the head of `main` (a re-run of an old run would
   otherwise publish older code as "Latest").
2. `pnpm verify` and the migration check (`pnpm db:generate` must not change
   anything).
3. Determine the version (`scripts/release-version.ts`): the current UTC time, or —
   when that is not strictly newer than the highest existing tag (two pushes in the
   same second, a clock running behind) — the highest tag plus one second. Written
   into `package.json` in the checkout only.
4. `pnpm tauri build --no-bundle`, then `mixmap.exe` and `mixmap.exe.sha256`
   (`sha256sum` format).
5. Check the head of `main` again, then `gh release create v<version> --latest
   --generate-notes` with both files.

Only one run per ref at a time: a new push cancels the running one (its commits are
part of the newer release; a cancelled run never created a tag). The workflow token is
read-only except for the release job, and checkout does not keep credentials.

Pull requests are checked by `.github/workflows/ci.yml` (same checks plus a build); its
exe is kept for 7 days as a workflow artifact for trying it out.

## Auto-update

`src-tauri/src/updater.rs`, commands `update_check` and `update_install`:

- **Check** (on startup and "Check for updates" in Settings):
  `GET https://api.github.com/repos/patrick-b6n/mixmap/releases/latest` (no token, no
  personal data), compare the tag with the running version. The UI offers the update
  in a banner — never while the overlay is shown, never automatically.
- **Install**: ask GitHub again (no URLs are taken from the WebView), download
  `mixmap.exe.sha256` and `mixmap.exe` of that release (only from this repository's
  release downloads), check size and SHA-256 and that it is a Windows executable,
  rename the running exe to `mixmap.exe.old`, put the new one in its place (undone if
  that fails) and restart. The next start deletes `.old`. Debug builds refuse to
  install.

Releases before this setup published `latest.json` instead; copies older than this
setup don't see the new releases and have to be replaced by hand once.

## Building locally

```sh
pnpm install
pnpm tauri build --no-bundle   # → src-tauri/target/release/mixmap.exe
```
