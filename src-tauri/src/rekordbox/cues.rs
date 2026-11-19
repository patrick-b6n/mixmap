//! Hot cues, memory cues and loops from master.db (`djmdCue`).

use std::collections::HashMap;

use rusqlite::Connection;
use serde::Serialize;

/// One cue point of a track, as rekordbox shows it.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Cue {
    /// rekordbox cue colour 1–8 (pink, red, orange, yellow, green, aqua, blue, purple);
    /// None = rekordbox's default colour.
    pub color: Option<u8>,
    pub comment: String,
    /// Loop end in milliseconds; None for a point cue.
    pub end_ms: Option<u32>,
    /// Hot cue letter A–H; None for a memory cue.
    pub hot_cue: Option<char>,
    pub start_ms: u32,
}

/// `djmdCue.Kind`: 0 is a memory cue, 1–3 are hot cues A–C, 5–9 are D–H (4 is unused).
/// `None` for kinds we don't know.
fn hot_cue(kind: i64) -> Option<Option<char>> {
    let index = match kind {
        0 => return Some(None),
        1..=3 => kind - 1,
        5..=9 => kind - 2,
        _ => return None,
    };
    Some(Some(char::from(b'A' + u8::try_from(index).ok()?)))
}

/// All cues by track id, each track's sorted by start.
pub fn read_cues(conn: &Connection) -> rusqlite::Result<HashMap<String, Vec<Cue>>> {
    let mut stmt = conn.prepare(
        "SELECT CAST(ContentID AS TEXT), IFNULL(Kind, -1), IFNULL(InMsec, -1),
                IFNULL(OutMsec, -1), IFNULL(Color, -1), IFNULL(Comment, '')
         FROM djmdCue
         WHERE IFNULL(rb_local_deleted, 0) = 0 AND ContentID IS NOT NULL
         ORDER BY ContentID, InMsec",
    )?;
    let mut out: HashMap<String, Vec<Cue>> = HashMap::new();
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, i64>(1)?,
            r.get::<_, i64>(2)?,
            r.get::<_, i64>(3)?,
            r.get::<_, i64>(4)?,
            r.get::<_, String>(5)?,
        ))
    })?;
    for row in rows {
        let (track_id, kind, start, end, color, comment) = row?;
        let (Some(hot_cue), Ok(start_ms)) = (hot_cue(kind), u32::try_from(start)) else {
            continue;
        };
        out.entry(track_id).or_default().push(Cue {
            color: u8::try_from(color).ok().filter(|c| (1..=8).contains(c)),
            comment,
            // -1 = no loop.
            end_ms: u32::try_from(end).ok().filter(|&e| e > start_ms),
            hot_cue,
            start_ms,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds_map_to_letters() {
        let kinds: Vec<_> = (0..=10).map(hot_cue).collect();
        assert_eq!(
            kinds,
            [
                Some(None),
                Some(Some('A')),
                Some(Some('B')),
                Some(Some('C')),
                None,
                Some(Some('D')),
                Some(Some('E')),
                Some(Some('F')),
                Some(Some('G')),
                Some(Some('H')),
                None,
            ]
        );
    }

    #[test]
    fn reads_cues_loops_and_skips_deleted() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE djmdCue (ContentID, Kind, InMsec, OutMsec, Color, Comment,
                rb_local_deleted);
             INSERT INTO djmdCue VALUES ('1', 2, 5000, -1, -1, NULL, 0),
                ('1', 0, 1000, -1, 3, 'drop', 0), ('1', 6, 9000, 12000, 255, '', 0),
                ('1', 1, 0, -1, -1, '', 1), ('1', 4, 100, -1, -1, '', 0),
                ('2', 0, 7000, 7000, NULL, NULL, NULL);",
        )
        .unwrap();
        let cues = read_cues(&conn).unwrap();
        let cue = |color, comment: &str, end_ms, hot_cue, start_ms| Cue {
            color,
            comment: comment.into(),
            end_ms,
            hot_cue,
            start_ms,
        };
        assert_eq!(
            cues["1"],
            [
                cue(Some(3), "drop", None, None, 1000),
                cue(None, "", None, Some('B'), 5000),
                cue(None, "", Some(12000), Some('E'), 9000),
            ]
        );
        // An out-point at the in-point is not a loop.
        assert_eq!(cues["2"], [cue(None, "", None, None, 7000)]);
    }

    #[test]
    fn reads_fixture_cues() {
        let Some(db) = crate::rekordbox::library::tests::fixture() else {
            return;
        };
        let lib = crate::rekordbox::library::load(&db).unwrap();
        // Tracks prepared with known cues in the local fixture; skip on other snapshots.
        let Some(cues) = lib.cues.get("179928232") else {
            return;
        };
        let summary: Vec<_> = cues
            .iter()
            .map(|c| (c.hot_cue, c.start_ms, c.end_ms))
            .collect();
        assert_eq!(
            summary,
            [
                (Some('A'), 421, None),
                (Some('B'), 27041, None),
                (Some('C'), 67604, None),
                (Some('D'), 108_168, None),
                (None, 148_731, None),
                (None, 189_294, None),
                (None, 229_858, Some(236_618)),
                (Some('E'), 270_421, Some(277_182)),
                (Some('H'), 290_703, None),
            ]
        );
    }
}
