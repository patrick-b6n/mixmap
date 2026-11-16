//! Loading the rekordbox library (tracks, playlists) into memory.

use std::path::Path;

use rusqlite::{Connection, MAIN_DB};
use serde::Serialize;

use super::playlists::{Playlist, read_histories, read_playlists};
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
    /// rekordbox key name as stored (`ScaleName`), e.g. "8A" or "Am"; parsed in the UI.
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
    /// History tree (sessions grouped in folders); ids prefixed with `h`.
    pub histories: Vec<Playlist>,
    /// Playlist tree, flat with `parent_id`, sorted by parent then position.
    pub playlists: Vec<Playlist>,
    pub tracks: Vec<Track>,
}

/// Decrypt and load the rekordbox `master.db` at `db_path`. Read-only by construction:
/// the file is only read as bytes and the database lives in memory.
pub fn load(db_path: &Path) -> Result<Library, Error> {
    let img = sqlcipher::decrypt_file(db_path)?;
    let conn = open_image(&img)?;
    read(&conn).map_err(sql_err)
}

fn read(conn: &Connection) -> rusqlite::Result<Library> {
    Ok(Library {
        histories: read_histories(conn)?,
        playlists: read_playlists(conn)?,
        tracks: read_tracks(conn)?,
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
        let key: String = r.get(6)?;
        Ok(Track {
            album: r.get(3)?,
            artist: r.get(2)?,
            artwork_path: (!artwork.is_empty()).then_some(artwork),
            bpm: r.get::<_, f64>(5)? / 100.0,
            comment: r.get(8)?,
            file_path: r.get(10)?,
            genre: r.get(4)?,
            id: r.get(0)?,
            key,
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
        let ids: std::collections::HashSet<_> = lib.tracks.iter().map(|t| &t.id).collect();
        for p in lib.playlists.iter().chain(&lib.histories) {
            assert!(p.track_ids.iter().all(|id| ids.contains(id)), "{p:?}");
        }
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

    #[test]
    fn playlist_tree_and_history() {
        use crate::rekordbox::playlists::PlaylistKind::*;
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE djmdContent (ID, Title, ArtistID, AlbumID, GenreID, BPM, KeyID, Rating,
                Commnt, Length, FolderPath, ImagePath, rb_local_deleted);
             CREATE TABLE djmdArtist (ID, Name); CREATE TABLE djmdAlbum (ID, Name);
             CREATE TABLE djmdGenre (ID, Name); CREATE TABLE djmdKey (ID, ScaleName);
             CREATE TABLE djmdPlaylist (ID, Seq, Name, Attribute, ParentID, rb_local_deleted);
             CREATE TABLE djmdSongPlaylist (PlaylistID, ContentID, TrackNo, rb_local_deleted);
             CREATE TABLE djmdHistory (ID, Seq, Name, Attribute, ParentID, rb_local_deleted);
             CREATE TABLE djmdSongHistory (HistoryID, ContentID, TrackNo, rb_local_deleted);
             INSERT INTO djmdContent VALUES ('1','A',NULL,NULL,NULL,12800,NULL,3,'',300,'a.mp3','',0),
                ('2','B',NULL,NULL,NULL,12600,NULL,0,'',200,'b.mp3','',0);
             INSERT INTO djmdPlaylist VALUES ('10',2,'Sets',1,'root',0), ('11',1,'Warm-up',0,'10',0),
                ('12',1,'Top',0,'root',0), ('13',2,'Smart',4,'10',0), ('14',3,'Gone',0,'root',1);
             INSERT INTO djmdSongPlaylist VALUES ('11','2',2,0), ('11','1',1,0), ('11','2',3,1),
                ('11','99',4,0), ('13','1',1,0);
             INSERT INTO djmdHistory VALUES ('20',1,'2026-11',1,'root',0), ('21',1,'2026-11-14',0,'20',0);
             INSERT INTO djmdSongHistory VALUES ('21','1',1,0), ('21','2',2,0);",
        )
        .unwrap();
        let lib = read(&conn).unwrap();
        let summary: Vec<_> = lib
            .playlists
            .iter()
            .map(|p| {
                (
                    p.id.as_str(),
                    p.kind,
                    p.parent_id.as_deref(),
                    p.track_ids.join(","),
                )
            })
            .collect();
        assert_eq!(
            summary,
            [
                ("12", Playlist, None, String::new()),
                ("10", Folder, None, String::new()),
                ("11", Playlist, Some("10"), "1,2".into()),
                ("13", Smart, Some("10"), String::new()),
            ]
        );
        assert_eq!(lib.histories[1].id, "h21");
        assert_eq!(lib.histories[1].parent_id.as_deref(), Some("h20"));
        assert_eq!(lib.histories[1].kind, History);
        assert_eq!(lib.histories[1].track_ids, ["1", "2"]);
    }
}
