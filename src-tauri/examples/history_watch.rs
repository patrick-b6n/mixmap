//! Spike #36: does rekordbox write its history to master.db while you play?
//!
//! Decrypts master.db (+ committed WAL frames) read-only once per second and prints
//! every new `djmdSongHistory` row and every `djmdContent.DJPlayCount` change, with
//! the time it was first seen. Run while loading and playing tracks in rekordbox:
//!
//!     cargo run --release -p mixmap-core --example history_watch
//!
//! Never writes anything: rekordbox's files are only read and decrypted in memory.

use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant, SystemTime};

use mixmap_lib::rekordbox::{location, sqlcipher};
use rusqlite::{Connection, MAIN_DB};

fn open(img: &[u8]) -> rusqlite::Result<Connection> {
    let mut conn = Connection::open_in_memory()?;
    conn.deserialize_read_exact(MAIN_DB, img, img.len(), true)?;
    Ok(conn)
}

fn stamp(start: Instant) -> String {
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let (h, m, s) = ((now / 3600) % 24, (now / 60) % 60, now % 60);
    format!(
        "{h:02}:{m:02}:{s:02} UTC (+{:>5.1}s)",
        start.elapsed().as_secs_f32()
    )
}

fn mtime(p: &std::path::Path) -> Option<SystemTime> {
    std::fs::metadata(p).and_then(|m| m.modified()).ok()
}

/// (history row id → "session · track no · title – artist · created/updated")
fn history(conn: &Connection) -> rusqlite::Result<HashMap<String, String>> {
    let mut stmt = conn.prepare(
        "SELECT CAST(s.ID AS TEXT), IFNULL(h.Name, '?'), IFNULL(s.TrackNo, 0),
                IFNULL(c.Title, '?'), IFNULL(a.Name, ''), IFNULL(s.created_at, ''), IFNULL(s.updated_at, '')
         FROM djmdSongHistory s
         LEFT JOIN djmdHistory h ON h.ID = s.HistoryID
         LEFT JOIN djmdContent c ON c.ID = s.ContentID
         LEFT JOIN djmdArtist a ON a.ID = c.ArtistID
         WHERE IFNULL(s.rb_local_deleted, 0) = 0",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            format!(
                "history \"{}\" #{} · {} – {} · created {} updated {}",
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, String>(6)?,
            ),
        ))
    })?;
    rows.collect()
}

/// content id → (play count, title)
fn plays(conn: &Connection) -> rusqlite::Result<HashMap<String, (i64, String)>> {
    let mut stmt = conn.prepare(
        "SELECT CAST(ID AS TEXT), IFNULL(DJPlayCount, 0), IFNULL(Title, '?') FROM djmdContent",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            (r.get::<_, i64>(1)?, r.get::<_, String>(2)?),
        ))
    })?;
    rows.collect()
}

fn main() {
    let loc = location::locate(None).expect("locate master.db");
    let db = loc.db_path.clone();
    let wal = db.with_extension("db-wal");
    println!("watching {} (read-only); Ctrl+C to stop", db.display());
    let start = Instant::now();
    let (mut seen_history, mut seen_plays) = (HashSet::new(), HashMap::new());
    let (mut last_db, mut last_wal) = (mtime(&db), mtime(&wal));
    let mut first = true;
    loop {
        let (db_t, wal_t) = (mtime(&db), mtime(&wal));
        if !first && (db_t != last_db || wal_t != last_wal) {
            println!(
                "{}  file change: master.db {}, master.db-wal {}",
                stamp(start),
                if db_t != last_db { "modified" } else { "-" },
                if wal_t != last_wal { "modified" } else { "-" }
            );
        }
        (last_db, last_wal) = (db_t, wal_t);
        let t0 = Instant::now();
        match sqlcipher::decrypt_file(&db)
            .and_then(|img| open(&img).map_err(|e| mixmap_lib::Error::Invalid(e.to_string())))
        {
            Ok(conn) => {
                let h = history(&conn).unwrap_or_default();
                let p = plays(&conn).unwrap_or_default();
                if first {
                    println!(
                        "{}  baseline: {} history rows, {} tracks (read in {} ms)",
                        stamp(start),
                        h.len(),
                        p.len(),
                        t0.elapsed().as_millis()
                    );
                    seen_history.extend(h.keys().cloned());
                    seen_plays = p.into_iter().map(|(k, (n, _))| (k, n)).collect();
                    first = false;
                } else {
                    for (id, desc) in &h {
                        if seen_history.insert(id.clone()) {
                            println!("{}  NEW HISTORY ROW: {desc}", stamp(start));
                        }
                    }
                    for (id, (n, title)) in &p {
                        let old = seen_plays.insert(id.clone(), *n);
                        if old.is_some_and(|o| o != *n) {
                            println!(
                                "{}  PLAY COUNT: {title}: {} → {n}",
                                stamp(start),
                                old.unwrap_or(0)
                            );
                        }
                    }
                }
            }
            Err(e) => println!("{}  read error: {e}", stamp(start)),
        }
        std::thread::sleep(Duration::from_secs(1));
    }
}
