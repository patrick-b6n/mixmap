//! Musical keys: parsing rekordbox key names and formatting them as Camelot
//! (primary) and musical notation.

/// A key on the Camelot wheel: `number` 1–12, `minor` = "A", major = "B".
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Key {
    pub minor: bool,
    pub number: u8,
}

/// Musical names by Camelot number (index 0 = 1A / 1B).
const MINOR: [&str; 12] = [
    "Abm", "Ebm", "Bbm", "Fm", "Cm", "Gm", "Dm", "Am", "Em", "Bm", "F#m", "C#m",
];
const MAJOR: [&str; 12] = [
    "B", "F#", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E",
];

impl Key {
    pub fn camelot(self) -> String {
        format!("{}{}", self.number, if self.minor { 'A' } else { 'B' })
    }

    pub fn musical(self) -> &'static str {
        let names = if self.minor { &MINOR } else { &MAJOR };
        names[usize::from(self.number - 1)]
    }

    /// Parse Camelot ("8A"), Open Key ("1m", "1d") or musical notation
    /// ("Am", "A minor", "F#m", "Gbmin", "Db", "C major"). Case-insensitive.
    pub fn parse(s: &str) -> Option<Key> {
        let s = s.trim();
        parse_wheel(s).or_else(|| parse_musical(s))
    }
}

/// Camelot (`<n>A|B`) and Open Key (`<n>m|d`, Open Key 1 = Camelot 8).
fn parse_wheel(s: &str) -> Option<Key> {
    let split = s.find(|c: char| !c.is_ascii_digit())?;
    let (num, suffix) = s.split_at(split);
    let n: u8 = num.parse().ok().filter(|n| (1..=12).contains(n))?;
    match suffix.to_ascii_lowercase().as_str() {
        "a" => Some(Key {
            minor: true,
            number: n,
        }),
        "b" => Some(Key {
            minor: false,
            number: n,
        }),
        "m" => Some(Key {
            minor: true,
            number: (n + 6) % 12 + 1,
        }),
        "d" => Some(Key {
            minor: false,
            number: (n + 6) % 12 + 1,
        }),
        _ => None,
    }
}

fn parse_musical(s: &str) -> Option<Key> {
    let mut chars = s.chars();
    let root = match chars.next()?.to_ascii_uppercase() {
        'C' => 0,
        'D' => 2,
        'E' => 4,
        'F' => 5,
        'G' => 7,
        'A' => 9,
        'B' => 11,
        _ => return None,
    };
    let mut rest: String = chars.collect::<String>().trim().to_ascii_lowercase();
    let mut pitch: i32 = root;
    if let Some(r) = rest.strip_prefix(['#', '♯']) {
        pitch += 1;
        rest = r.trim().to_string();
    } else if let Some(r) = rest.strip_prefix(['b', '♭']) {
        pitch -= 1;
        rest = r.trim().to_string();
    }
    let minor = match rest.as_str() {
        "" | "maj" | "major" => false,
        "m" | "min" | "minor" => true,
        _ => return None,
    };
    let pitch = pitch.rem_euclid(12);
    // Camelot number for major key with pitch class p: C (0) = 8B, each fifth (+7) = +1.
    // A minor key shares the number of its relative major (pitch + 3).
    let major_pitch = if minor { (pitch + 3) % 12 } else { pitch };
    let fifths = (major_pitch * 7) % 12; // steps around the circle of fifths from C
    let number = u8::try_from((fifths + 7) % 12 + 1).expect("1..=12");
    Some(Key { minor, number })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_24_keys_round_trip() {
        for number in 1..=12 {
            for minor in [true, false] {
                let k = Key { minor, number };
                assert_eq!(Key::parse(&k.camelot()), Some(k), "{}", k.camelot());
                assert_eq!(Key::parse(k.musical()), Some(k), "{}", k.musical());
            }
        }
    }

    #[test]
    fn known_mapping() {
        let cases = [
            ("1A", "Abm"),
            ("2A", "Ebm"),
            ("3A", "Bbm"),
            ("4A", "Fm"),
            ("5A", "Cm"),
            ("6A", "Gm"),
            ("7A", "Dm"),
            ("8A", "Am"),
            ("9A", "Em"),
            ("10A", "Bm"),
            ("11A", "F#m"),
            ("12A", "C#m"),
            ("1B", "B"),
            ("2B", "F#"),
            ("3B", "Db"),
            ("4B", "Ab"),
            ("5B", "Eb"),
            ("6B", "Bb"),
            ("7B", "F"),
            ("8B", "C"),
            ("9B", "G"),
            ("10B", "D"),
            ("11B", "A"),
            ("12B", "E"),
        ];
        for (camelot, musical) in cases {
            let k = Key::parse(camelot).unwrap();
            assert_eq!(k.camelot(), camelot);
            assert_eq!(k.musical(), musical, "{camelot}");
        }
    }

    #[test]
    fn enharmonics_and_spellings() {
        let p = |s| Key::parse(s).map(Key::camelot);
        assert_eq!(p("G#m").as_deref(), Some("1A"));
        assert_eq!(p("D#m").as_deref(), Some("2A"));
        assert_eq!(p("Gb").as_deref(), Some("2B"));
        assert_eq!(p("C#").as_deref(), Some("3B"));
        assert_eq!(p("A minor").as_deref(), Some("8A"));
        assert_eq!(p("c major").as_deref(), Some("8B"));
        assert_eq!(p("bbmin").as_deref(), Some("3A"));
        assert_eq!(p("8a").as_deref(), Some("8A"));
        assert_eq!(p("1d").as_deref(), Some("8B")); // Open Key
        assert_eq!(p("6m").as_deref(), Some("1A"));
        assert_eq!(p("Cb").as_deref(), Some("1B")); // = B
        assert_eq!(p("E#").as_deref(), Some("7B")); // = F
        assert_eq!(p("B#m").as_deref(), Some("5A")); // = Cm
        assert_eq!(p("D♭").as_deref(), Some("3B"));
        for n in 1..=12u8 {
            // Open Key n and Camelot n+7 (mod 12) are the same key.
            let c = (n + 6) % 12 + 1;
            assert_eq!(p(&format!("{n}d")), Some(format!("{c}B")));
            assert_eq!(p(&format!("{n}m")), Some(format!("{c}A")));
        }
    }

    #[test]
    fn rejects_garbage() {
        for s in ["", "13A", "0B", "H", "Am7", "8C", "x"] {
            assert_eq!(Key::parse(s), None, "{s}");
        }
    }
}
