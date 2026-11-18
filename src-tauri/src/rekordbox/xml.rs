//! rekordbox XML export (`DJ_PLAYLISTS`) as a fallback library source.
//!
//! Collection tracks become `Track`s, the `PLAYLISTS` node tree becomes playlists
//! (`Type="0"` folder, `Type="1"` playlist). Track ids are the XML `TrackID`s, which
//! differ from master.db ids; mixmap matches tracks by portable key anyway.

use std::collections::HashMap;
use std::path::Path;

use percent_encoding::percent_decode_str;
use quick_xml::Reader;
use quick_xml::events::{BytesStart, Event};

use super::library::{Library, Track};
use super::playlists::{Playlist, PlaylistKind};
use crate::Error;

pub fn load(path: &Path) -> Result<Library, Error> {
    let xml = std::fs::read_to_string(path)
        .map_err(|e| Error::NotFound(format!("cannot read {}: {e}", path.display())))?;
    parse(&xml)
}

pub(crate) fn parse(xml: &str) -> Result<Library, Error> {
    let mut reader = Reader::from_str(xml);
    let mut lib = Library::default();
    let mut saw_root = false;
    let mut in_collection = false;
    let mut in_playlists = false;
    // Stack of open playlist NODEs: (index into lib.playlists, None for ROOT;
    // entries keyed by Location instead of TrackID, i.e. KeyType="1").
    let mut nodes: Vec<(Option<usize>, bool)> = Vec::new();
    // TrackID by Location, for playlists exported with KeyType="1".
    let mut id_by_location: HashMap<String, String> = HashMap::new();
    let mut seq = 0i64;
    let err = |e: &dyn std::fmt::Display| Error::Invalid(format!("rekordbox XML: {e}"));

    loop {
        let ev = reader.read_event().map_err(|e| err(&e))?;
        let (start, empty) = match &ev {
            Event::Start(s) => (Some(s), false),
            Event::Empty(s) => (Some(s), true),
            _ => (None, false),
        };
        if let Some(s) = start {
            let a = attrs(s)?;
            let name: &str = s.name().into_inner();
            match name {
                "DJ_PLAYLISTS" => saw_root = true,
                "COLLECTION" => in_collection = !empty,
                "PLAYLISTS" => in_playlists = !empty,
                "TRACK" if in_collection && nodes.is_empty() => {
                    let t = track(&a);
                    if !t.id.is_empty() {
                        if let Some(loc) = a.get("Location") {
                            id_by_location.insert(loc.clone(), t.id.clone());
                        }
                        lib.tracks.push(t);
                    }
                }
                "TRACK" if in_playlists => {
                    if let (Some(&(Some(i), by_location)), Some(key)) = (nodes.last(), a.get("Key"))
                    {
                        let id = if by_location {
                            id_by_location.get(key).cloned()
                        } else {
                            Some(key.clone())
                        };
                        if let Some(id) = id {
                            lib.playlists[i].track_ids.push(id);
                        }
                    }
                }
                "NODE" if in_playlists => {
                    let is_root = nodes.is_empty() && a.get("Name").is_some_and(|n| n == "ROOT");
                    let idx = if is_root {
                        None
                    } else {
                        seq += 1;
                        let parent_id = nodes
                            .iter()
                            .rev()
                            .find_map(|&(p, _)| p)
                            .map(|p| lib.playlists[p].id.clone());
                        lib.playlists.push(Playlist {
                            id: format!("x{seq}"),
                            kind: if a.get("Type").is_some_and(|t| t == "0") {
                                PlaylistKind::Folder
                            } else {
                                PlaylistKind::Playlist
                            },
                            name: a.get("Name").cloned().unwrap_or_default(),
                            parent_id,
                            seq,
                            track_ids: Vec::new(),
                        });
                        Some(lib.playlists.len() - 1)
                    };
                    if !empty {
                        nodes.push((idx, a.get("KeyType").is_some_and(|k| k == "1")));
                    }
                }
                _ => {}
            }
        }
        match ev {
            Event::End(e) => match e.name().into_inner() {
                "COLLECTION" => in_collection = false,
                "PLAYLISTS" => in_playlists = false,
                "NODE" if in_playlists => {
                    nodes.pop();
                }
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
    }
    if !saw_root {
        return Err(Error::Invalid(
            "not a rekordbox XML export (no DJ_PLAYLISTS)".into(),
        ));
    }
    // Only keep playlist entries that point to collection tracks.
    let known: std::collections::HashSet<String> =
        lib.tracks.iter().map(|t| t.id.clone()).collect();
    for p in &mut lib.playlists {
        p.track_ids.retain(|id| known.contains(id));
    }
    Ok(lib)
}

fn attrs(s: &BytesStart) -> Result<HashMap<String, String>, Error> {
    let mut out = HashMap::new();
    for a in s.attributes() {
        let a = a.map_err(|e| Error::Invalid(format!("rekordbox XML: {e}")))?;
        let value = a
            .normalized_value(quick_xml::XmlVersion::Explicit1_0)
            .map_err(|e| Error::Invalid(format!("rekordbox XML: {e}")))?;
        out.insert(a.key.into_inner().to_string(), value.into_owned());
    }
    Ok(out)
}

fn track(a: &HashMap<String, String>) -> Track {
    let s = |k: &str| a.get(k).cloned().unwrap_or_default();
    let num = |k: &str| a.get(k).and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0);
    Track {
        album: s("Album"),
        analysis_path: None,
        artist: s("Artist"),
        artwork_path: None,
        bpm: num("AverageBpm"),
        comment: s("Comments"),
        file_path: location_to_path(&s("Location")),
        genre: s("Genre"),
        id: s("TrackID"),
        key: s("Tonality"),
        length: num("TotalTime").max(0.0) as u32,
        // XML ratings are 0, 51, 102, 153, 204, 255.
        rating: (num("Rating") / 51.0).round().clamp(0.0, 5.0) as u8,
        title: s("Name"),
    }
}

/// `file://localhost/C:/Music/a%20b.mp3` → `C:/Music/a b.mp3`; UNC
/// (`file://localhost//server/share/x`) and rooted paths keep their leading slashes.
fn location_to_path(loc: &str) -> String {
    let rest = loc
        .strip_prefix("file://localhost")
        .or_else(|| loc.strip_prefix("file://"))
        .unwrap_or(loc);
    let path = percent_decode_str(rest).decode_utf8_lossy().into_owned();
    // "/C:/..." → "C:/..."
    let b = path.as_bytes();
    if b.len() >= 3 && b[0] == b'/' && b[1].is_ascii_alphabetic() && b[2] == b':' {
        path[1..].to_string()
    } else {
        path
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const XML: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<DJ_PLAYLISTS Version="1.0.0">
  <PRODUCT Name="rekordbox" Version="7.2.19" Company="AlphaTheta"/>
  <COLLECTION Entries="3">
    <TRACK TrackID="11" Name="Ecstasy &amp; More" Artist="ATB" Album="A" Genre="Trance"
      TotalTime="353" AverageBpm="142.00" Rating="204" Comments="nice" Tonality="Am"
      Location="file://localhost/C:/Music/ATB%20-%20Ecstasy.flac">
      <TEMPO Inizio="0.025" Bpm="142.00" Metro="4/4" Battito="1"/>
    </TRACK>
    <TRACK TrackID="12" Name="Cola" Artist="CamelPhat" TotalTime="342" AverageBpm="130.00"
      Rating="0" Tonality="3A" Location="file://localhost/C:/Music/Cola.mp3"/>
    <TRACK TrackID="13" Name="Ünïcode" Location="file://localhost/C:/M%C3%BCsik/x.mp3"/>
  </COLLECTION>
  <PLAYLISTS>
    <NODE Type="0" Name="ROOT" Count="2">
      <NODE Name="Sets" Type="0" Count="1">
        <NODE Name="Warm-up" Type="1" KeyType="0" Entries="3">
          <TRACK Key="12"/>
          <TRACK Key="11"/>
          <TRACK Key="999"/>
        </NODE>
      </NODE>
      <NODE Name="By location" Type="1" KeyType="1" Entries="1">
        <TRACK Key="file://localhost/C:/Music/Cola.mp3"/>
      </NODE>
      <NODE Name="Empty" Type="1" KeyType="0" Entries="0"/>
    </NODE>
  </PLAYLISTS>
</DJ_PLAYLISTS>"#;

    #[test]
    fn parses_collection() {
        let lib = parse(XML).unwrap();
        assert_eq!(lib.tracks.len(), 3);
        let t = &lib.tracks[0];
        assert_eq!(t.id, "11");
        assert_eq!(t.title, "Ecstasy & More");
        assert_eq!(t.bpm, 142.0);
        assert_eq!(t.rating, 4);
        assert_eq!(t.length, 353);
        assert_eq!(t.key, "Am");
        assert_eq!(t.file_path, "C:/Music/ATB - Ecstasy.flac");
        assert_eq!(lib.tracks[2].file_path, "C:/Müsik/x.mp3");
    }

    #[test]
    fn parses_playlist_tree() {
        let lib = parse(XML).unwrap();
        let summary: Vec<_> = lib
            .playlists
            .iter()
            .map(|p| {
                (
                    p.name.as_str(),
                    p.kind,
                    p.parent_id.clone(),
                    p.track_ids.clone(),
                )
            })
            .collect();
        assert_eq!(
            summary,
            [
                ("Sets", PlaylistKind::Folder, None, vec![]),
                (
                    "Warm-up",
                    PlaylistKind::Playlist,
                    Some("x1".into()),
                    vec!["12".into(), "11".into()]
                ),
                (
                    "By location",
                    PlaylistKind::Playlist,
                    None,
                    vec!["12".into()]
                ),
                ("Empty", PlaylistKind::Playlist, None, vec![]),
            ]
        );
        assert!(lib.histories.is_empty());
    }

    #[test]
    fn decodes_locations() {
        assert_eq!(
            location_to_path("file://localhost/C:/a%20b.mp3"),
            "C:/a b.mp3"
        );
        assert_eq!(location_to_path("file:///D:/x.mp3"), "D:/x.mp3");
        assert_eq!(
            location_to_path("file://localhost//nas/music/x.mp3"),
            "//nas/music/x.mp3"
        );
        assert_eq!(
            location_to_path("file://localhost/Users/me/x.mp3"),
            "/Users/me/x.mp3"
        );
    }

    #[test]
    fn rejects_other_files() {
        assert!(parse("<html></html>").is_err());
        assert!(parse("not xml <<<").is_err());
    }
}
