// The version of the release being built (run by the release workflow).
//
//   gh api … tags | node scripts/release-version.ts          print version and title
//   gh api … tags | node scripts/release-version.ts --set    also write it into package.json
//
// Reads the existing release tags (`v<version>`, one per line) from stdin. The version
// is the CalVer of now (UTC), or the highest tag + 1 second if now isn't newer
// (src/domain/calver.ts). Output, one per line for $GITHUB_OUTPUT: version=…, title=…
// tauri.conf.json takes the app version from package.json; nothing is committed.
import { readFileSync, writeFileSync } from "node:fs";
import { nextReleaseVersion, releaseTitle } from "../src/domain/calver.ts";

const tags = readFileSync(0, "utf8").split(/\r?\n/).filter(Boolean);
const { date, version } = nextReleaseVersion(new Date(), tags);

if (process.argv.includes("--set")) {
  const file = new URL("../package.json", import.meta.url);
  const json = JSON.parse(readFileSync(file, "utf8"));
  json.version = version;
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}

console.log(`version=${version}`);
console.log(`title=${releaseTitle(date)}`);
