// Musical keys: parsing rekordbox key names and formatting them as Camelot
// (primary) and musical notation.

/** A key on the Camelot wheel: `num` 1–12, `minor` = "A", major = "B". */
export type Key = { minor: boolean; num: number };

/** Musical names by Camelot number (index 0 = 1A / 1B). */
const MINOR = ["Abm", "Ebm", "Bbm", "Fm", "Cm", "Gm", "Dm", "Am", "Em", "Bm", "F#m", "C#m"];
const MAJOR = ["B", "F#", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E"];

const ROOTS: Record<string, number> = { A: 9, B: 11, C: 0, D: 2, E: 4, F: 5, G: 7 };

export function camelot(k: Key): string {
  return `${k.num}${k.minor ? "A" : "B"}`;
}

export function musical(k: Key): string {
  // num is 1–12 for every parsed key.
  return (k.minor ? MINOR : MAJOR)[k.num - 1] ?? camelot(k);
}

/**
 * Parse Camelot ("8A"), Open Key ("1m", "1d") or musical notation
 * ("Am", "A minor", "F#m", "Gbmin", "Db", "C major"). Case-insensitive.
 */
export function parseKey(s: string): Key | undefined {
  const t = s.trim();
  return parseWheel(t) ?? parseMusical(t);
}

/** Camelot (`<n>A|B`) and Open Key (`<n>m|d`; Open Key 1 = Camelot 8). */
function parseWheel(s: string): Key | undefined {
  const m = /^(\d{1,2})([abmd])$/i.exec(s);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (n < 1 || n > 12) return undefined;
  switch (m[2]?.toLowerCase()) {
    case "a":
      return { minor: true, num: n };
    case "b":
      return { minor: false, num: n };
    case "m":
      return { minor: true, num: ((n + 6) % 12) + 1 };
    default:
      return { minor: false, num: ((n + 6) % 12) + 1 };
  }
}

function parseMusical(s: string): Key | undefined {
  const root = ROOTS[s.charAt(0).toUpperCase()];
  if (root === undefined) return undefined;
  let rest = s.slice(1).trim().toLowerCase();
  let pitch = root;
  if (rest.startsWith("#") || rest.startsWith("♯")) {
    pitch += 1;
    rest = rest.slice(1).trim();
  } else if (rest.startsWith("b") || rest.startsWith("♭")) {
    pitch -= 1;
    rest = rest.slice(1).trim();
  }
  let minor: boolean;
  if (["", "maj", "major"].includes(rest)) minor = false;
  else if (["m", "min", "minor"].includes(rest)) minor = true;
  else return undefined;
  pitch = ((pitch % 12) + 12) % 12;
  // Camelot number of a major key with pitch class p: C (0) = 8B, each fifth (+7) = +1.
  // A minor key shares the number of its relative major (pitch + 3).
  const majorPitch = minor ? (pitch + 3) % 12 : pitch;
  const fifths = (majorPitch * 7) % 12;
  return { minor, num: ((fifths + 7) % 12) + 1 };
}
