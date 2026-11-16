// The version of the release being built (run by the release workflow).
//
//   gh api … tags | node scripts/release-version.ts          print version, semver and title
//   gh api … tags | node scripts/release-version.ts --set    also write the semver into package.json
//
// Reads the existing release tags (`v<version>`, one per line) from stdin. The version
// is the CalVer `YYYY.MM.DD.HHMM` of now (UTC), or the latest tag's minute + 1 if now
// isn't newer (src/business/calver.ts). package.json gets its SemVer form
// (`YYYY.MMDD.HHMM`), which tauri.conf.json reads; nothing is committed.
// Output, one per line for $GITHUB_OUTPUT: version=…, semver=…, title=…
import { readFileSync, writeFileSync } from "node:fs";
import { calverToSemver, nextReleaseVersion } from "../src/business/calver.ts";

const tags = readFileSync(0, "utf8").split(/\r?\n/).filter(Boolean);
const { version } = nextReleaseVersion(new Date(), tags);
const semver = calverToSemver(version);
if (!semver) throw new Error(`no SemVer for ${version}`);

if (process.argv.includes("--set")) {
  const file = new URL("../package.json", import.meta.url);
  const json = JSON.parse(readFileSync(file, "utf8"));
  json.version = semver;
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}

console.log(`version=${version}`);
console.log(`semver=${semver}`);
console.log(`title=mixmap ${version}`);
