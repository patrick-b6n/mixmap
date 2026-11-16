//! Diagnostics for #41: how big is rekordbox's memory, how fast is a scan, where is a
//! title? Read-only.
//!
//!     cargo run --release -p mixmap-core --example memory_probe -- "Some Title"

use std::time::Instant;

use mixmap_lib::memory::pointers::{Options, find_chains};
use mixmap_lib::memory::process::{Process, find_pid};
use mixmap_lib::memory::scan::find_strings;
use mixmap_lib::memory::{Encoding, Memory};

fn main() {
    let title = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "Cola (Cyava Edit)".into());
    let pid = find_pid("rekordbox.exe").expect("rekordbox is not running");
    let p = Process::open(pid).expect("open rekordbox");
    let regions = p.regions();
    let total: u64 = regions.iter().map(|r| r.size).sum();
    println!(
        "rekordbox {} (pid {pid}): {} regions, {} MB readable, module {:#x}+{:#x}",
        p.version().unwrap_or_default(),
        regions.len(),
        total >> 20,
        p.module().base,
        p.module().size
    );
    let mut targets = vec![];
    for enc in [Encoding::Utf8, Encoding::Utf16] {
        let t = Instant::now();
        let hits = find_strings(&p, &title, enc, |_, _| {});
        println!(
            "{enc:?}: {} hits for {title:?} in {:.1} s",
            hits.len(),
            t.elapsed().as_secs_f32()
        );
        targets.extend(hits);
    }
    let t = Instant::now();
    let chains = find_chains(&p, &targets, Options::default(), |d, n| {
        println!("  level {d}/{n} after {:.1} s", t.elapsed().as_secs_f32())
    });
    println!(
        "{} chains in {:.1} s",
        chains.len(),
        t.elapsed().as_secs_f32()
    );
    for (c, _) in chains.iter().take(5) {
        println!("  {c:?}");
    }
}
