// CalVer: every release is versioned by its UTC build time, `YYYY.MM.DD.HHMM`
// (`2026.11.16.1345`) in tags, release titles, the UI and logs. Tauri and the Windows
// file version need three-part SemVer without leading zeros, so the app itself
// (package.json, the exe) carries `YYYY.(MM*100+DD).(HH*100+MM)` (`2026.1116.1345`).
// Same conversion as src-tauri/src/updater.rs.

const pad = (n: number) => String(n).padStart(2, "0");

/** The CalVer of a UTC instant (seconds are dropped). */
export function calver(date: Date): string {
  return `${date.getUTCFullYear()}.${pad(date.getUTCMonth() + 1)}.${pad(date.getUTCDate())}.${pad(
    date.getUTCHours(),
  )}${pad(date.getUTCMinutes())}`;
}

/** The UTC instant a CalVer stands for; undefined for anything else. */
export function parseCalver(version: string): Date | undefined {
  const m = /^(\d{4})\.(\d{2})\.(\d{2})\.(\d{2})(\d{2})$/.exec(version.trim());
  if (!m) return undefined;
  const [y, month, day, h, min] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  return validDate(y, month, day, h, min);
}

/** `2026.11.16.1345` → `2026.1116.1345`; undefined if it is no CalVer. */
export function calverToSemver(version: string): string | undefined {
  const d = parseCalver(version);
  if (!d) return undefined;
  const mmdd = (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  const hhmm = d.getUTCHours() * 100 + d.getUTCMinutes();
  return `${d.getUTCFullYear()}.${mmdd}.${hhmm}`;
}

/** `2026.1116.1345` → `2026.11.16.1345`; undefined if it is not such a SemVer. */
export function semverToCalver(version: string): string | undefined {
  const m = /^(\d{4})\.([1-9]\d{2,3})\.(0|[1-9]\d{0,3})$/.exec(version.trim());
  if (!m) return undefined;
  const [y, mmdd, hhmm] = m.slice(1).map(Number) as [number, number, number];
  const d = validDate(y, Math.floor(mmdd / 100), mmdd % 100, Math.floor(hhmm / 100), hhmm % 100);
  return d && calver(d);
}

/** Tags of releases before CalVer `YYYY.MM.DD.HHMM`: `YYYY.MMDD.HHMMSS` (seconds). */
function parseOldTag(version: string): Date | undefined {
  const m = /^(\d{4})\.(\d{3,4})\.(\d{1,6})$/.exec(version.trim());
  if (!m) return undefined;
  const [y, md, hms] = m.slice(1).map(Number) as [number, number, number];
  const d = validDate(
    y,
    Math.floor(md / 100),
    md % 100,
    Math.floor(hms / 10000),
    Math.floor(hms / 100) % 100,
  );
  return d && new Date(d.getTime() + (hms % 100) * 1000);
}

function validDate(y: number, month: number, day: number, h: number, min: number) {
  if (month < 1 || month > 12 || day < 1 || day > 31 || h > 23 || min > 59) return undefined;
  const d = new Date(Date.UTC(y, month - 1, day, h, min));
  return d.getUTCDate() === day ? d : undefined;
}

/**
 * The version of a release published at `now`, given the existing release tags
 * (`v<version>`, also the older `YYYY.MMDD.HHMMSS` ones): the CalVer of `now`, unless
 * that isn't strictly newer than the latest tag (two pushes within a minute, a clock
 * running behind) – then the latest tag's minute plus one. So every release gets a
 * new, higher version and never fails.
 */
export function nextReleaseVersion(
  now: Date,
  tags: readonly string[],
): { date: Date; version: string } {
  const latest = Math.max(
    -Infinity,
    ...tags.map((tag) => {
      const v = tag.trim().replace(/^v/, "");
      return (parseCalver(v) ?? parseOldTag(v))?.getTime() ?? -Infinity;
    }),
  );
  const minute = Math.floor(now.getTime() / 60_000) * 60_000;
  const date = new Date(minute > latest ? minute : Math.floor(latest / 60_000) * 60_000 + 60_000);
  return { date, version: calver(date) };
}
