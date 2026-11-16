// Stamp the CalVer version of this build into every manifest (run by CI before building).
//
//   node ui/scripts/calver.ts                 print version and release title (now)
//   node ui/scripts/calver.ts --set           also write it into Cargo.toml, tauri.conf.json, package.json
//   node ui/scripts/calver.ts --time <ISO>    use another instant
//
// Output (one per line, for GitHub Actions $GITHUB_OUTPUT): version=…, title=…
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { calver, releaseTitle } from "../src/domain/calver.ts";

const args = process.argv.slice(2);
const timeArg = args.indexOf("--time");
const date = timeArg >= 0 ? new Date(args[timeArg + 1]) : new Date();
if (Number.isNaN(date.getTime())) throw new Error("invalid --time");
const version = calver(date);

if (args.includes("--set")) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const cargo = `${root}Cargo.toml`;
  const toml = readFileSync(cargo, "utf8");
  const stamped = toml.replace(/(\[workspace\.package\][^[]*?\nversion = )"[^"]*"/, `$1"${version}"`);
  if (stamped === toml && !toml.includes(`version = "${version}"`))
    throw new Error("no workspace version in Cargo.toml");
  writeFileSync(cargo, stamped);
  for (const file of [`${root}src-tauri/tauri.conf.json`, `${root}ui/package.json`]) {
    const json = JSON.parse(readFileSync(file, "utf8"));
    json.version = version;
    writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  }
}

console.log(`version=${version}`);
console.log(`title=${releaseTitle(date)}`);
