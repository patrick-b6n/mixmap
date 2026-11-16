// CalVer: every build is versioned by its UTC build time, as semver-compatible numbers
// YYYY.MMDD.HHMMSS without leading zeros (5 Jan 00:30:12 → 2026.105.3012).

const pad = (n: number) => String(n).padStart(2, "0");

/** Semver-compatible version for a UTC instant. */
export function calver(date: Date): string {
  const mmdd = (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
  const hhmmss = date.getUTCHours() * 10000 + date.getUTCMinutes() * 100 + date.getUTCSeconds();
  return `${date.getUTCFullYear()}.${mmdd}.${hhmmss}`;
}

/** Release title: "2026-11-14 15:30:12 UTC". */
export function releaseTitle(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(
    date.getUTCHours(),
  )}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`;
}

/** The UTC instant a CalVer version stands for; undefined for anything else (e.g. "0.1.0"). */
export function parseCalver(version: string): Date | undefined {
  const m = /^(\d{4})\.(\d{3,4})\.(\d{1,6})$/.exec(version.trim());
  if (!m) return undefined;
  const [y, md, hms] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const month = Math.floor(md / 100);
  const day = md % 100;
  const [h, min, s] = [Math.floor(hms / 10000), Math.floor(hms / 100) % 100, hms % 100];
  if (month < 1 || month > 12 || day < 1 || day > 31 || h > 23 || min > 59 || s > 59) return undefined;
  const d = new Date(Date.UTC(y, month - 1, day, h, min, s));
  return d.getUTCDate() === day ? d : undefined;
}

/** Whether `candidate` is a newer CalVer build than `current` (non-CalVer current = dev build: never). */
export function isNewer(candidate: string, current: string): boolean {
  const a = parseCalver(candidate);
  const b = parseCalver(current);
  return a !== undefined && b !== undefined && a.getTime() > b.getTime();
}

/**
 * The version of a release published at `now`, given the existing release tags
 * (`v<version>`): the CalVer of `now`, unless that isn't strictly newer than the
 * highest tag (two pushes within a second, a clock running behind) – then the highest
 * tag plus one second. So every release gets a new, higher version and never fails.
 */
export function nextReleaseVersion(now: Date, tags: readonly string[]): { date: Date; version: string } {
  const latest = Math.max(
    -Infinity,
    ...tags.map((tag) => parseCalver(tag.trim().replace(/^v/, ""))?.getTime() ?? -Infinity),
  );
  const date = now.getTime() > latest ? now : new Date(latest + 1000);
  return { date, version: calver(date) };
}
