//! rekordbox playlist tree (folders, playlists, smart playlists) and history.

use rusqlite::Connection;
use serde::Serialize;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PlaylistKind {
    Folder,
    /// A history list (one DJ session). Histories live in their own tree.
    History,
    Playlist,
    /// Smart playlist: rule-based. Contents are not evaluated (see `track_ids`).
    Smart,
}

/// One node of the playlist or history tree. The tree is flat; use `parent_id`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    /// Unique across playlists and histories: history ids are prefixed with `h`.
    pub id: String,
    pub kind: PlaylistKind,
    pub name: String,
    /// `None` for top-level nodes.
    pub parent_id: Option<String>,
    /// Sort position among siblings.
    pub seq: i64,
    /// Ordered track ids. Empty for folders and smart playlists (rule evaluation
    /// is not supported).
    pub track_ids: Vec<String>,
}

const ROOT: &str = "root";

pub(crate) fn read_playlists(conn: &Connection) -> rusqlite::Result<Vec<Playlist>> {
    let mut lists = read_nodes(
        conn,
        "SELECT CAST(ID AS TEXT), IFNULL(Name, ''), IFNULL(Attribute, 0), CAST(ParentID AS TEXT),
                IFNULL(Seq, 0)
         FROM djmdPlaylist WHERE IFNULL(rb_local_deleted, 0) = 0",
        "",
        |attr| match attr {
            1 => PlaylistKind::Folder,
            4 => PlaylistKind::Smart,
            _ => PlaylistKind::Playlist,
        },
    )?;
    fill_tracks(
        conn,
        &mut lists,
        "",
        "SELECT CAST(PlaylistID AS TEXT), CAST(ContentID AS TEXT) FROM djmdSongPlaylist
         WHERE IFNULL(rb_local_deleted, 0) = 0 AND ContentID IN (SELECT ID FROM djmdContent WHERE IFNULL(rb_local_deleted, 0) = 0)
         ORDER BY PlaylistID, TrackNo, rowid",
    )?;
    Ok(lists)
}

pub(crate) fn read_histories(conn: &Connection) -> rusqlite::Result<Vec<Playlist>> {
    let mut lists = read_nodes(
        conn,
        "SELECT CAST(ID AS TEXT), IFNULL(Name, ''), IFNULL(Attribute, 0), CAST(ParentID AS TEXT),
                IFNULL(Seq, 0)
         FROM djmdHistory WHERE IFNULL(rb_local_deleted, 0) = 0",
        "h",
        |attr| match attr {
            1 => PlaylistKind::Folder,
            _ => PlaylistKind::History,
        },
    )?;
    fill_tracks(
        conn,
        &mut lists,
        "h",
        "SELECT CAST(HistoryID AS TEXT), CAST(ContentID AS TEXT) FROM djmdSongHistory
         WHERE IFNULL(rb_local_deleted, 0) = 0 AND ContentID IN (SELECT ID FROM djmdContent WHERE IFNULL(rb_local_deleted, 0) = 0)
         ORDER BY HistoryID, TrackNo, rowid",
    )?;
    Ok(lists)
}

fn read_nodes(
    conn: &Connection,
    sql: &str,
    prefix: &str,
    kind: impl Fn(i64) -> PlaylistKind,
) -> rusqlite::Result<Vec<Playlist>> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([], |r| {
        let parent: Option<String> = r.get(3)?;
        Ok(Playlist {
            id: format!("{prefix}{}", r.get::<_, String>(0)?),
            kind: kind(r.get(2)?),
            name: r.get(1)?,
            parent_id: parent
                .filter(|p| p != ROOT && !p.is_empty())
                .map(|p| format!("{prefix}{p}")),
            seq: r.get(4)?,
            track_ids: Vec::new(),
        })
    })?;
    let mut lists: Vec<Playlist> = rows.collect::<rusqlite::Result<_>>()?;
    lists.sort_by(|a, b| {
        a.parent_id
            .cmp(&b.parent_id)
            .then(a.seq.cmp(&b.seq))
            .then(a.id.cmp(&b.id))
    });
    Ok(lists)
}

fn fill_tracks(
    conn: &Connection,
    lists: &mut [Playlist],
    prefix: &str,
    sql: &str,
) -> rusqlite::Result<()> {
    let index: std::collections::HashMap<String, usize> = lists
        .iter()
        .enumerate()
        .map(|(i, p)| (p.id.clone(), i))
        .collect();
    let mut stmt = conn.prepare(sql)?;
    let mut rows = stmt.query([])?;
    while let Some(r) = rows.next()? {
        let list: String = r.get(0)?;
        if let Some(&i) = index.get(&format!("{prefix}{list}")) {
            if !matches!(lists[i].kind, PlaylistKind::Folder | PlaylistKind::Smart) {
                lists[i].track_ids.push(r.get(1)?);
            }
        }
    }
    Ok(())
}
