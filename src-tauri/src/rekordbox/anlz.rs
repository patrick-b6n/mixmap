//! rekordbox analysis files (`ANLZ0000.DAT`, `.EXT`, `.2EX`): waveform, beat grid and
//! phrases of a track.
//!
//! Format as reverse-engineered by Deep Symmetry (crate-digger): big-endian; a `PMAI`
//! file header, then tagged sections of `fourcc, header length, section length`. The
//! files are only read; unknown or damaged sections are skipped.

use std::path::Path;

use serde::Serialize;

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Analysis {
    /// Beat grid (`PQTZ`), in time order.
    pub beats: Vec<Beat>,
    /// Phrases (`PSSI`), in time order.
    pub phrases: Vec<Phrase>,
    pub waveform: Option<Waveform>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Beat {
    /// Position in its bar, 1–4 (1 = downbeat).
    pub bar_position: u8,
    pub time_ms: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PhraseKind {
    Bridge,
    Chorus,
    Down,
    Intro,
    Outro,
    Up,
    Verse,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Phrase {
    pub end_ms: u32,
    pub kind: PhraseKind,
    /// Verse number (1–6); None for other kinds.
    pub number: Option<u8>,
    pub start_ms: u32,
}

/// Whole-track overview waveform.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Waveform {
    /// `PWAV`: one height 0–31 per column.
    Mono { values: Vec<u8> },
    /// `PWV6`: three heights per column, in the order low, mid, high.
    ThreeBand { values: Vec<u8> },
}

/// Read the analysis of a track from its `ANLZ0000.DAT` (and the `.EXT` / `.2EX` next
/// to it). None when the `.DAT` can't be read.
pub fn load(dat_path: &Path) -> Option<Analysis> {
    let dat = std::fs::read(dat_path).ok()?;
    let sibling = |ext: &str| std::fs::read(dat_path.with_extension(ext)).ok();
    let (ext, ex2) = (sibling("EXT"), sibling("2EX"));
    let beats = section(&dat, b"PQTZ").map(beat_grid).unwrap_or_default();
    let phrases = ext
        .as_deref()
        .and_then(|f| section(f, b"PSSI"))
        .map(|s| phrases(s, &beats))
        .unwrap_or_default();
    let waveform = ex2
        .as_deref()
        .and_then(|f| section(f, b"PWV6"))
        .and_then(three_band)
        .or_else(|| section(&dat, b"PWAV").and_then(mono));
    Some(Analysis {
        beats,
        phrases,
        waveform,
    })
}

fn be16(b: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_be_bytes(b.get(at..at + 2)?.try_into().ok()?))
}

fn be32(b: &[u8], at: usize) -> Option<usize> {
    let v = u32::from_be_bytes(b.get(at..at + 4)?.try_into().ok()?);
    usize::try_from(v).ok()
}

/// The first section with `tag` (header included).
fn section<'a>(file: &'a [u8], tag: &[u8; 4]) -> Option<&'a [u8]> {
    if file.get(..4)? != b"PMAI" {
        return None;
    }
    let mut off = be32(file, 4)?;
    while off + 12 <= file.len() {
        let len = be32(file, off + 8)?;
        if len < 12 {
            return None;
        }
        let s = file.get(off..off.checked_add(len)?)?;
        if &s[..4] == tag {
            return Some(s);
        }
        off += len;
    }
    None
}

/// The section's entries after its header: `count` entries of `size` bytes, but never
/// more than the section holds.
fn entries(s: &[u8], count: usize, size: usize) -> Option<&[u8]> {
    let start = be32(s, 4)?;
    let count = count.min(s.len().checked_sub(start)? / size);
    s.get(start..start + count * size)
}

fn beat_grid(s: &[u8]) -> Vec<Beat> {
    let Some(data) = be32(s, 20).and_then(|count| entries(s, count, 8)) else {
        return Vec::new();
    };
    data.as_chunks::<8>()
        .0
        .iter()
        .map(|e| Beat {
            bar_position: e[1],
            time_ms: u32::from_be_bytes([e[4], e[5], e[6], e[7]]),
        })
        .collect()
}

fn three_band(s: &[u8]) -> Option<Waveform> {
    if be32(s, 12)? != 3 {
        return None;
    }
    // Stored as low, mid, high (checked against rekordbox: in a breakdown without bass
    // the first byte drops below the second, so rekordbox's blue disappears).
    let values = entries(s, be32(s, 16)?, 3)?.to_vec();
    Some(Waveform::ThreeBand { values })
}

fn mono(s: &[u8]) -> Option<Waveform> {
    let data = entries(s, be32(s, 12)?, 1)?;
    // Low 5 bits: height; high 3 bits: whiteness (not used).
    let values = data.iter().map(|b| b & 0x1f).collect();
    Some(Waveform::Mono { values })
}

/// rekordbox 6+ may XOR the phrase data after the entry count with this mask (plus the
/// entry count); applying it again restores the data.
const PSSI_MASK: [u8; 19] = [
    0xCB, 0xE1, 0xEE, 0xFA, 0xE5, 0xEE, 0xAD, 0xEE, 0xE9, 0xD2, 0xE9, 0xEB, 0xE1, 0xE9, 0xF3, 0xE8,
    0xE9, 0xF4, 0xE1,
];

fn toggle_pssi_mask(s: &mut [u8], count: u16) {
    for (i, b) in s.iter_mut().skip(18).enumerate() {
        *b ^= PSSI_MASK[i % PSSI_MASK.len()].wrapping_add(count.to_be_bytes()[1]);
    }
}

fn phrases(s: &[u8], beats: &[Beat]) -> Vec<Phrase> {
    try_phrases(s, beats).unwrap_or_default()
}

fn try_phrases(s: &[u8], beats: &[Beat]) -> Option<Vec<Phrase>> {
    let count = be16(s, 16)?;
    let mut s = s.to_vec();
    // The mood is 1–3; anything else means the data is masked.
    if !(1..=3).contains(&be16(&s, 18)?) {
        toggle_pssi_mask(&mut s, count);
    }
    let mood = be16(&s, 18)?;
    let end_beat = be16(&s, 26)?;
    if be32(&s, 12)? != 24 || beats.is_empty() {
        return None;
    }
    let data = entries(&s, usize::from(count), 24)?;
    let starts: Vec<(u16, u16)> = data
        .as_chunks::<24>()
        .0
        .iter()
        .filter_map(|e| Some((be16(e, 2)?, be16(e, 4)?)))
        .collect();
    let time = |beat: u16| {
        let i = usize::from(beat.max(1)) - 1;
        beats.get(i).or(beats.last()).map_or(0, |b| b.time_ms)
    };
    let mut out = Vec::new();
    for (i, &(beat, kind)) in starts.iter().enumerate() {
        let Some((kind, number)) = phrase_kind(mood, kind) else {
            continue;
        };
        let end = starts.get(i + 1).map_or(end_beat, |n| n.0);
        // A missing or bad end beat (old or damaged files): run to the end of the grid.
        let end_ms = if end > beat {
            time(end)
        } else {
            beats.last().map_or(0, |b| b.time_ms)
        };
        out.push(Phrase {
            end_ms,
            kind,
            number,
            start_ms: time(beat),
        });
    }
    Some(out)
}

/// Phrase kind by track mood (1 = high, 2 = mid, 3 = low).
fn phrase_kind(mood: u16, kind: u16) -> Option<(PhraseKind, Option<u8>)> {
    use PhraseKind::*;
    let verse = |n: u8| Some((Verse, Some(n)));
    match (mood, kind) {
        (1..=3, 1) => Some((Intro, None)),
        (1, 2) => Some((Up, None)),
        (1, 3) => Some((Down, None)),
        (1, 5) => Some((Chorus, None)),
        (1, 6) => Some((Outro, None)),
        (2, 2..=7) => verse(u8::try_from(kind - 1).ok()?),
        (3, 2..=4) => verse(1),
        (3, 5..=7) => verse(2),
        (2 | 3, 8) => Some((Bridge, None)),
        (2 | 3, 9) => Some((Chorus, None)),
        (2 | 3, 10) => Some((Outro, None)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A section: tag, header length, section length, the rest of the header, the body.
    fn sec(tag: &[u8; 4], header: &[u8], body: &[u8]) -> Vec<u8> {
        let hl = 12 + header.len();
        let mut s = tag.to_vec();
        s.extend((hl as u32).to_be_bytes());
        s.extend(((hl + body.len()) as u32).to_be_bytes());
        s.extend(header);
        s.extend(body);
        s
    }

    fn file(sections: &[Vec<u8>]) -> Vec<u8> {
        let body = sections.concat();
        let mut f = b"PMAI".to_vec();
        f.extend(28u32.to_be_bytes());
        f.extend(((28 + body.len()) as u32).to_be_bytes());
        f.resize(28, 0);
        f.extend(body);
        f
    }

    fn u32s(v: &[u32]) -> Vec<u8> {
        v.iter().flat_map(|x| x.to_be_bytes()).collect()
    }

    fn grid(n: u32) -> Vec<u8> {
        let body: Vec<u8> = (0..n)
            .flat_map(|i| {
                let mut e = vec![0, (i % 4 + 1) as u8, 0x32, 0xC8]; // 128.00 BPM
                e.extend((1000 + i * 500).to_be_bytes());
                e
            })
            .collect();
        sec(b"PQTZ", &u32s(&[0, 0x80000, n]), &body)
    }

    /// PSSI with `(beat, kind)` entries.
    fn pssi(mood: u16, end_beat: u16, phrases: &[(u16, u16)]) -> Vec<u8> {
        let mut header = 24u32.to_be_bytes().to_vec();
        header.extend((phrases.len() as u16).to_be_bytes());
        header.extend(mood.to_be_bytes());
        header.extend([0; 6]);
        header.extend(end_beat.to_be_bytes());
        header.extend([0; 4]);
        let body: Vec<u8> = phrases
            .iter()
            .enumerate()
            .flat_map(|(i, (beat, kind))| {
                let mut e = (i as u16 + 1).to_be_bytes().to_vec();
                e.extend(beat.to_be_bytes());
                e.extend(kind.to_be_bytes());
                e.resize(24, 0);
                e
            })
            .collect();
        sec(b"PSSI", &header, &body)
    }

    fn beats(n: u32) -> Vec<Beat> {
        let f = file(&[grid(n)]);
        beat_grid(section(&f, b"PQTZ").unwrap())
    }

    #[test]
    fn reads_beat_grid() {
        let b = beats(5);
        assert_eq!(b.len(), 5);
        assert_eq!(
            b[4],
            Beat {
                bar_position: 1,
                time_ms: 3000
            }
        );
    }

    #[test]
    fn reads_three_band_and_mono_without_whiteness() {
        let pwv6 = sec(b"PWV6", &u32s(&[3, 2]), &[10, 20, 30, 11, 21, 31]);
        let f = file(&[pwv6]);
        assert_eq!(
            three_band(section(&f, b"PWV6").unwrap()),
            Some(Waveform::ThreeBand {
                values: vec![10, 20, 30, 11, 21, 31]
            })
        );
        let pwav = sec(b"PWAV", &u32s(&[3, 0x10000]), &[0xE5, 0x1F, 0x00]);
        let f = file(&[pwav]);
        assert_eq!(
            mono(section(&f, b"PWAV").unwrap()),
            Some(Waveform::Mono {
                values: vec![5, 31, 0]
            })
        );
    }

    #[test]
    fn reads_plain_and_masked_phrases() {
        let b = beats(40);
        let s = pssi(1, 33, &[(1, 1), (9, 2), (17, 4), (25, 5)]);
        let plain = phrases(&s, &b);
        let summary: Vec<_> = plain
            .iter()
            .map(|p| (p.kind, p.start_ms, p.end_ms))
            .collect();
        // Kind 4 is unknown in a high-mood track: skipped, the one before still ends at it.
        assert_eq!(
            summary,
            [
                (PhraseKind::Intro, 1000, 5000),
                (PhraseKind::Up, 5000, 9000),
                (PhraseKind::Chorus, 13000, 17000),
            ]
        );
        let mut masked = s.clone();
        toggle_pssi_mask(&mut masked, 4);
        assert_ne!(masked, s);
        assert_eq!(phrases(&masked, &b), plain);
    }

    #[test]
    fn verse_numbers_by_mood() {
        let b = beats(10);
        let kinds = |mood| -> Vec<_> {
            phrases(&pssi(mood, 9, &[(1, 3), (2, 6), (3, 8)]), &b)
                .iter()
                .map(|p| (p.kind, p.number))
                .collect()
        };
        use PhraseKind::*;
        assert_eq!(
            kinds(2),
            [(Verse, Some(2)), (Verse, Some(5)), (Bridge, None)]
        );
        assert_eq!(
            kinds(3),
            [(Verse, Some(1)), (Verse, Some(2)), (Bridge, None)]
        );
    }

    #[test]
    fn damaged_files_give_nothing() {
        assert_eq!(section(b"nope", b"PQTZ"), None);
        let mut f = file(&[grid(4)]);
        f.truncate(f.len() - 3);
        assert_eq!(section(&f, b"PQTZ"), None);
        // A count beyond the data is capped, not trusted.
        let lying = sec(b"PQTZ", &u32s(&[0, 0, 1_000_000]), &[0; 16]);
        assert_eq!(beat_grid(&lying).len(), 2);
        assert!(phrases(&pssi(1, 5, &[(1, 1)]), &[]).is_empty());
        // No end beat: the last phrase runs to the end of the grid.
        let last = phrases(&pssi(1, 0, &[(1, 1), (5, 2)]), &beats(8));
        assert_eq!((last[1].start_ms, last[1].end_ms), (3000, 4500));
    }

    #[test]
    fn reads_fixture_analysis() {
        let Some(db) = crate::rekordbox::library::tests::fixture() else {
            return;
        };
        let lib = crate::rekordbox::library::load(&db).unwrap();
        let Some(track) = lib.tracks.iter().find(|t| t.id == "179928232") else {
            return;
        };
        let root = db.parent().unwrap().join("share");
        let rel = track.analysis_path.as_deref().unwrap();
        let path = crate::rekordbox::location::under_root(&root, rel).unwrap();
        if !path.is_file() {
            eprintln!("skipping: no analysis files in fixtures/share");
            return;
        }
        let a = load(&path).unwrap();
        assert_eq!(a.beats.len(), 836);
        assert_eq!(a.beats[0].time_ms, 421);
        let Some(Waveform::ThreeBand { values }) = &a.waveform else {
            panic!("no 3-band waveform: {:?}", a.waveform);
        };
        assert_eq!(values.len(), 3600);
        // Band order, as rekordbox shows it: the breakdown after hot cue C (~68–80 s) has
        // no bass (low below mid), the chorus after D (~110–140 s) has (low above mid).
        let average = |from_s: f64, to_s: f64, band: usize| {
            let col = |s: f64| (s / 353.3 * 1200.0) as usize;
            let cols = col(from_s)..col(to_s);
            let n = cols.len() as f64;
            cols.map(|c| f64::from(values[c * 3 + band])).sum::<f64>() / n
        };
        assert!(average(68.0, 80.0, 0) < average(68.0, 80.0, 1));
        assert!(average(110.0, 140.0, 0) > average(110.0, 140.0, 1));
        assert_eq!(a.phrases.len(), 21);
        assert_eq!(a.phrases[0].kind, PhraseKind::Intro);
        assert_eq!(a.phrases[0].start_ms, 421);
        assert_eq!(a.phrases[20].kind, PhraseKind::Outro);
        assert!(a.phrases.windows(2).all(|w| w[0].end_ms == w[1].start_ms));
    }
}
