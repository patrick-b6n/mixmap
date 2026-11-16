//! Track artwork: rekordbox artwork if present, otherwise the cover embedded in the
//! audio file (ID3 / FLAC / MP4 via `lofty`). Thumbnails are cached as JPEG files;
//! `None` means "no artwork" and the UI shows a placeholder.

use std::io::Cursor;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use image::{ImageFormat, ImageReader, Limits, imageops::FilterType};
use lofty::picture::PictureType;
use lofty::prelude::*;
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::rekordbox::library::Track;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Size {
    /// Details panel.
    Large,
    /// Table rows and graph nodes.
    Small,
}

impl Size {
    fn px(self) -> u32 {
        match self {
            Size::Large => 600,
            Size::Small => 96,
        }
    }

    fn name(self) -> &'static str {
        match self {
            Size::Large => "l",
            Size::Small => "s",
        }
    }
}

/// Thumbnail cache in a directory (normally `%APPDATA%\mixmap\artwork`).
pub struct ArtworkCache {
    dir: PathBuf,
}

impl ArtworkCache {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    /// Path of a cached JPEG thumbnail for `track`, creating it if needed.
    pub fn thumbnail(
        &self,
        track: &Track,
        analysis_root: Option<&Path>,
        size: Size,
    ) -> Option<PathBuf> {
        let source = Source::find(track, analysis_root)?;
        let key = cache_key(&source, size);
        let thumb = self.dir.join(format!("{key}.jpg"));
        let none_marker = self.dir.join(format!("{key}.none"));
        if thumb.is_file() {
            return Some(thumb);
        }
        if none_marker.is_file() {
            return None;
        }
        std::fs::create_dir_all(&self.dir).ok()?;
        // Err = could not read the file right now (e.g. locked): don't cache that.
        let bytes = source.image_bytes().ok()?;
        match bytes.and_then(|b| render(&b, size.px())) {
            Some(jpeg) => {
                // Write to a unique temp file first so a concurrent reader never sees
                // half a file, then move it into place.
                static SEQ: AtomicU64 = AtomicU64::new(0);
                let n = SEQ.fetch_add(1, Ordering::Relaxed);
                let tmp = self
                    .dir
                    .join(format!("{key}.{}-{n}.tmp", std::process::id()));
                let written =
                    std::fs::write(&tmp, jpeg).and_then(|()| std::fs::rename(&tmp, &thumb));
                if written.is_err() {
                    std::fs::remove_file(&tmp).ok();
                }
                // A failed rename usually means a concurrent call already put it there.
                thumb.is_file().then_some(thumb)
            }
            None => {
                // No usable picture: remember it until the source file changes.
                std::fs::write(&none_marker, b"").ok();
                None
            }
        }
    }
}

/// Orphaned thumbnails are kept this long (a library may come back, e.g. after a
/// temporarily missing drive).
const ORPHAN_GRACE: std::time::Duration = std::time::Duration::from_secs(7 * 24 * 3600);
/// Unfinished temp files from an interrupted write.
const TMP_GRACE: std::time::Duration = std::time::Duration::from_secs(3600);

impl ArtworkCache {
    /// Delete cache files no current track uses any more (source changed or gone),
    /// once they are older than a week, and stale temp files. Returns how many files
    /// were removed. Call only with a fully loaded library.
    pub fn prune(&self, tracks: &[Track], analysis_root: Option<&Path>) -> usize {
        self.prune_at(tracks, analysis_root, std::time::SystemTime::now())
    }

    fn prune_at(
        &self,
        tracks: &[Track],
        analysis_root: Option<&Path>,
        now: std::time::SystemTime,
    ) -> usize {
        let Ok(entries) = std::fs::read_dir(&self.dir) else {
            return 0;
        };
        let live: std::collections::HashSet<String> = tracks
            .iter()
            .filter_map(|t| Source::find(t, analysis_root))
            .flat_map(|s| [cache_key(&s, Size::Small), cache_key(&s, Size::Large)])
            .collect();
        let mut removed = 0;
        for e in entries.flatten() {
            let path = e.path();
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            let age = e
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| now.duration_since(t).ok())
                .unwrap_or_default();
            let stale = if name.ends_with(".tmp") {
                age >= TMP_GRACE
            } else if let Some(key) = name
                .strip_suffix(".jpg")
                .or_else(|| name.strip_suffix(".none"))
            {
                !live.contains(key) && age >= ORPHAN_GRACE
            } else {
                false // not ours: leave it
            };
            if stale && std::fs::remove_file(&path).is_ok() {
                removed += 1;
            }
        }
        removed
    }
}

/// Where a track's picture comes from, with the file's modification time and size so
/// the cache is invalidated when it changes.
enum Source {
    Audio(PathBuf, Stamp),
    Rekordbox(PathBuf, Stamp),
}

/// (modified millis, size in bytes)
type Stamp = (u128, u64);

impl Source {
    fn find(track: &Track, analysis_root: Option<&Path>) -> Option<Source> {
        if let (Some(root), Some(rel)) = (analysis_root, track.artwork_path.as_deref()) {
            let rel = Path::new(rel.trim_start_matches(['/', '\\']));
            // Only plain relative paths: no "..", drive letters or UNC prefixes.
            if rel.components().all(|c| matches!(c, Component::Normal(_))) {
                let p = root.join(rel);
                if let Some(st) = stamp(&p) {
                    return Some(Source::Rekordbox(p, st));
                }
            }
        }
        let p = PathBuf::from(&track.file_path);
        stamp(&p).map(|st| Source::Audio(p, st))
    }

    /// `Ok(None)`: the source has no picture. `Err`: it could not be read right now.
    fn image_bytes(&self) -> Result<Option<Vec<u8>>, std::io::Error> {
        match self {
            Source::Rekordbox(p, (_, len)) => {
                if *len > MAX_IMAGE_FILE {
                    return Ok(None);
                }
                std::fs::read(p).map(Some)
            }
            Source::Audio(p, _) => {
                std::fs::File::open(p)?; // fails while locked: retry next time
                Ok(embedded_cover(p))
            }
        }
    }
}

/// Larger standalone artwork files are ignored.
const MAX_IMAGE_FILE: u64 = 32 * 1024 * 1024;

fn stamp(p: &Path) -> Option<Stamp> {
    let meta = std::fs::metadata(p).ok().filter(|m| m.is_file())?;
    let t = meta.modified().ok()?;
    Some((
        t.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis(),
        meta.len(),
    ))
}

fn cache_key(source: &Source, size: Size) -> String {
    let (kind, path, (m, len)) = match source {
        Source::Audio(p, st) => ("a", p, st),
        Source::Rekordbox(p, st) => ("r", p, st),
    };
    let mut h = Sha256::new();
    h.update(format!("{kind}|{}|{m}|{len}", path.display()));
    let digest = h.finalize();
    let hex: String = digest[..12].iter().map(|b| format!("{b:02x}")).collect();
    format!("{hex}-{}", size.name())
}

/// Front cover if tagged as such, otherwise the first picture of any tag.
fn embedded_cover(path: &Path) -> Option<Vec<u8>> {
    let file = lofty::read_from_path(path).ok()?;
    let pictures = file.tags().iter().flat_map(|t| t.pictures());
    let all: Vec<_> = pictures.collect();
    let pic = all
        .iter()
        .find(|p| p.pic_type() == PictureType::CoverFront)
        .or_else(|| all.first())?;
    Some(pic.data().to_vec())
}

/// Decode, scale down to fit `px`×`px` (never up), encode as JPEG.
fn render(bytes: &[u8], px: u32) -> Option<Vec<u8>> {
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .ok()?;
    let mut limits = Limits::default();
    limits.max_alloc = Some(256 * 1024 * 1024);
    limits.max_image_width = Some(12_000);
    limits.max_image_height = Some(12_000);
    reader.limits(limits);
    let img = reader.decode().ok()?;
    let img = if img.width() > px || img.height() > px {
        img.resize(px, px, FilterType::Triangle)
    } else {
        img
    };
    let mut out = Cursor::new(Vec::new());
    img.to_rgb8().write_to(&mut out, ImageFormat::Jpeg).ok()?;
    Some(out.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(file_path: &str, artwork_path: Option<&str>) -> Track {
        Track {
            album: String::new(),
            artist: String::new(),
            artwork_path: artwork_path.map(Into::into),
            bpm: 0.0,
            comment: String::new(),
            file_path: file_path.into(),
            genre: String::new(),
            id: "1".into(),
            key: String::new(),
            length: 0,
            rating: 0,
            title: String::new(),
        }
    }

    fn temp_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("mixmap-art-{}-{name}", std::process::id()));
        std::fs::remove_dir_all(&d).ok();
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn png(w: u32, h: u32) -> Vec<u8> {
        let img = image::RgbImage::from_pixel(w, h, image::Rgb([200, 30, 30]));
        let mut out = Cursor::new(Vec::new());
        img.write_to(&mut out, ImageFormat::Png).unwrap();
        out.into_inner()
    }

    #[test]
    fn rekordbox_artwork_is_scaled_and_cached() {
        let root = temp_dir("rb");
        std::fs::create_dir_all(root.join("PIONEER/Artwork")).unwrap();
        std::fs::write(root.join("PIONEER/Artwork/a.png"), png(1000, 500)).unwrap();
        let cache = ArtworkCache::new(root.join("cache"));
        let t = track("C:/nope.mp3", Some("/PIONEER/Artwork/a.png"));

        let small = cache.thumbnail(&t, Some(&root), Size::Small).unwrap();
        let img = image::open(&small).unwrap();
        assert_eq!((img.width(), img.height()), (96, 48));
        // Second call is served from cache (same path).
        assert_eq!(cache.thumbnail(&t, Some(&root), Size::Small), Some(small));
        let large = image::open(cache.thumbnail(&t, Some(&root), Size::Large).unwrap()).unwrap();
        assert_eq!(large.width(), 600);
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn prunes_orphans_after_a_grace_period_and_keeps_live_entries() {
        use std::time::{Duration, SystemTime};
        let root = temp_dir("prune");
        std::fs::create_dir_all(root.join("PIONEER/Artwork")).unwrap();
        std::fs::write(root.join("PIONEER/Artwork/a.png"), png(200, 200)).unwrap();
        let cache = ArtworkCache::new(root.join("cache"));
        let t = track("C:/nope.mp3", Some("/PIONEER/Artwork/a.png"));
        let live = cache.thumbnail(&t, Some(&root), Size::Small).unwrap();
        let dir = root.join("cache");
        std::fs::write(dir.join("0123456789abcdef01234567-s.jpg"), b"old thumb").unwrap();
        std::fs::write(dir.join("0123456789abcdef01234567-l.none"), b"").unwrap();
        std::fs::write(dir.join("x.123-0.tmp"), b"half").unwrap();
        std::fs::write(dir.join("readme.txt"), b"not ours").unwrap();
        let tracks = [t.clone()];

        // Fresh orphans are kept (grace period).
        assert_eq!(cache.prune(&tracks, Some(&root)), 0);
        // Eight days later: orphans and the temp file go; the live thumbnail stays.
        let later = SystemTime::now() + Duration::from_secs(8 * 24 * 3600);
        assert_eq!(cache.prune_at(&tracks, Some(&root), later), 3);
        let mut left: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        left.sort();
        assert_eq!(
            left,
            [
                live.file_name().unwrap().to_string_lossy().into_owned(),
                "readme.txt".into()
            ]
        );

        // When the source changes, its old thumbnail becomes an orphan too.
        std::fs::write(root.join("PIONEER/Artwork/a.png"), png(300, 300)).unwrap();
        let new = cache.thumbnail(&t, Some(&root), Size::Small).unwrap();
        assert_ne!(new, live);
        assert_eq!(cache.prune_at(&tracks, Some(&root), later), 1);
        assert!(new.is_file() && !live.exists());
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn artwork_paths_cannot_escape_the_analysis_root() {
        let root = temp_dir("escape");
        std::fs::write(root.join("secret.png"), png(10, 10)).unwrap();
        let inner = root.join("share");
        std::fs::create_dir_all(&inner).unwrap();
        let cache = ArtworkCache::new(root.join("cache"));
        let t = track("C:/nope.mp3", Some("/../secret.png"));
        assert_eq!(cache.thumbnail(&t, Some(&inner), Size::Small), None);
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn missing_or_pictureless_sources_give_none() {
        let dir = temp_dir("none");
        let cache = ArtworkCache::new(dir.join("cache"));
        assert_eq!(
            cache.thumbnail(&track("C:/nope.mp3", None), None, Size::Small),
            None
        );
        let not_audio = dir.join("x.mp3");
        std::fs::write(&not_audio, b"not audio").unwrap();
        let t = track(not_audio.to_str().unwrap(), None);
        assert_eq!(cache.thumbnail(&t, None, Size::Small), None);
        assert_eq!(cache.thumbnail(&t, None, Size::Small), None); // via marker
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn embedded_id3_cover() {
        use lofty::config::WriteOptions;
        use lofty::picture::{MimeType, Picture};
        use lofty::tag::{Tag, TagType};

        let dir = temp_dir("id3");
        // 20 silent MPEG-1 Layer III frames (128 kbit/s, 44.1 kHz, 417 bytes each).
        let mut frame = vec![0u8; 417];
        frame[..4].copy_from_slice(&[0xFF, 0xFB, 0x90, 0x00]);
        let mp3 = dir.join("t.mp3");
        std::fs::write(&mp3, frame.repeat(20)).unwrap();
        let pic = Picture::unchecked(png(300, 300))
            .pic_type(PictureType::CoverFront)
            .mime_type(MimeType::Png)
            .build();
        let mut tag = Tag::new(TagType::Id3v2);
        tag.push_picture(pic);
        tag.save_to_path(&mp3, WriteOptions::default()).unwrap();

        let cache = ArtworkCache::new(dir.join("cache"));
        let thumb = cache
            .thumbnail(&track(mp3.to_str().unwrap(), None), None, Size::Small)
            .unwrap();
        let img = image::open(thumb).unwrap();
        assert_eq!((img.width(), img.height()), (96, 96));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn embedded_covers_from_fixture_library() {
        let Some(db) = crate::rekordbox::library::tests::fixture() else {
            return;
        };
        let lib = crate::rekordbox::library::load(&db).unwrap();
        let dir = temp_dir("fixture");
        let cache = ArtworkCache::new(dir.clone());
        let found = lib
            .tracks
            .iter()
            .filter(|t| std::path::Path::new(&t.file_path).is_file())
            .filter(|t| cache.thumbnail(t, None, Size::Small).is_some())
            .count();
        eprintln!("embedded covers: {found} of {}", lib.tracks.len());
        std::fs::remove_dir_all(dir).ok();
    }
}
