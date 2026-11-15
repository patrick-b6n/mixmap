//! Dump the smart playlists of the current rekordbox library (read-only), for #50.
//!
//!     cargo run --release -p mixmap-core --example smartlists [path/to/master.db]

use mixmap_core::rekordbox::{location, sqlcipher};
use rusqlite::{Connection, MAIN_DB};

fn main() {
    let db = std::env::args()
        .nth(1)
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| location::locate(None).expect("locate master.db").db_path);
    let img = sqlcipher::decrypt_file(&db).expect("decrypt");
    let mut conn = Connection::open_in_memory().unwrap();
    conn.deserialize_read_exact(MAIN_DB, &img[..], img.len(), true)
        .unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT CAST(ID AS TEXT), Name || ' [Attribute ' || IFNULL(Attribute, '?') || ', deleted ' || IFNULL(rb_local_deleted, 0) || ']',
                    IFNULL(SmartList, '') FROM djmdPlaylist
             ORDER BY Attribute, Name",
        )
        .unwrap();
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .unwrap();
    let mut n = 0;
    for row in rows {
        let (id, name, xml) = row.unwrap();
        n += 1;
        println!("--- {id} {name}\n{xml}");
    }
    println!("{n} smart playlists in {}", db.display());
}
