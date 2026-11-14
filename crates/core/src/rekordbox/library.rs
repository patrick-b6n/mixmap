//! Loading the rekordbox library (tracks, playlists) into memory.

use std::path::Path;

use rusqlite::{Connection, MAIN_DB};
use serde::Serialize;

use super::sqlcipher;
use crate::Error;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub album: String,
    pub artist: String,
    /// rekordbox artwork path as stored (relative to the analysis root), if any.
    pub artwork_path: Option<String>,
    /// Beats per minute (rekordbox stores BPM × 100).
    pub bpm: f64,
    pub comment: String,
    pub file_path: String,
    pub genre: String,
    pub id: String,
    /// rekordbox key name as stored (`ScaleName`), e.g. "8A" or "Am"; see `keys`.
    pub key: String,
    /// Length in seconds.
    pub length: u32,
    /// 0–5 stars.
    pub rating: u8,
    pub title: String,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Library {
    pub tracks: Vec<Track>,
}

/// Decrypt and load the rekordbox `master.db` at `db_path`. Read-only by construction:
/// the file is only read as bytes and the database lives in memory.
pub fn load(db_path: &Path) -> Result<Library, Error> {
    let img = sqlcipher::decrypt_file(db_path)?;
    let conn = open_image(&img)?;
    Ok(Library {
        tracks: read_tracks(&conn).map_err(sql_err)?,
    })
}

fn open_image(img: &[u8]) -> Result<Connection, Error> {
    let mut conn = Connection::open_in_memory().map_err(sql_err)?;
    conn.deserialize_read_exact(MAIN_DB, img, img.len(), true)
        .map_err(sql_err)?;
    Ok(conn)
}

fn sql_err(e: rusqlite::Error) -> Error {
    Error::Invalid(format!("rekordbox database: {e}"))
}

fn read_tracks(conn: &Connection) -> rusqlite::Result<Vec<Track>> {
    let mut stmt = conn.prepare(
        "SELECT CAST(c.ID AS TEXT), IFNULL(c.Title, ''), IFNULL(ar.Name, ''), IFNULL(al.Name, ''),
                IFNULL(g.Name, ''), IFNULL(c.BPM, 0), IFNULL(k.ScaleName, ''), IFNULL(c.Rating, 0),
                IFNULL(c.Commnt, ''), IFNULL(c.Length, 0), IFNULL(c.FolderPath, ''),
                IFNULL(c.ImagePath, '')
         FROM djmdContent c
         LEFT JOIN djmdArtist ar ON ar.ID = c.ArtistID
         LEFT JOIN djmdAlbum al ON al.ID = c.AlbumID
         LEFT JOIN djmdGenre g ON g.ID = c.GenreID
         LEFT JOIN djmdKey k ON k.ID = c.KeyID
         WHERE IFNULL(c.rb_local_deleted, 0) = 0
         ORDER BY c.ID",
    )?;
    let rows = stmt.query_map([], |r| {
        let artwork: String = r.get(11)?;
        Ok(Track {
            album: r.get(3)?,
            artist: r.get(2)?,
            artwork_path: (!artwork.is_empty()).then_some(artwork),
            bpm: r.get::<_, f64>(5)? / 100.0,
            comment: r.get(8)?,
            file_path: r.get(10)?,
            genre: r.get(4)?,
            id: r.get(0)?,
            key: r.get(6)?,
            length: r.get(9)?,
            rating: r.get(7)?,
            title: r.get(1)?,
        })
    })?;
    rows.collect()
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::path::PathBuf;

    /// Local snapshot of a real master.db (git-ignored). Tests skip without it.
    pub fn fixture() -> Option<PathBuf> {
        let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/master.db");
        if p.is_file() {
            Some(p)
        } else {
            eprintln!("skipping: no fixtures/master.db");
            None
        }
    }

    #[test]
    fn reads_tracks_from_fixture() {
        let Some(db) = fixture() else { return };
        let lib = load(&db).unwrap();
        assert!(!lib.tracks.is_empty());
        for t in &lib.tracks {
            assert!(!t.id.is_empty());
            assert!(!t.title.is_empty(), "{t:?}");
            assert!(t.bpm == 0.0 || (40.0..300.0).contains(&t.bpm), "{t:?}");
            assert!(t.rating <= 5);
        }
    }

    #[test]
    fn rejects_garbage() {
        let p = std::env::temp_dir().join(format!("mixmap-garbage-{}.db", std::process::id()));
        std::fs::write(&p, vec![7u8; 8192]).unwrap();
        let err = load(&p).unwrap_err();
        std::fs::remove_file(&p).ok();
        assert!(err.to_string().contains("decrypt"), "{err}");
    }
}
