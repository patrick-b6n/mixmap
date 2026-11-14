//! Locating the rekordbox library via rekordbox's own `options.json`.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::Error;

/// Where rekordbox keeps its library on this machine.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Location {
    /// Root of analysis data (`share` folder); artwork paths in master.db are relative to it.
    pub analysis_root: Option<PathBuf>,
    pub db_path: PathBuf,
    /// True when `db_path` came from the user's settings override.
    pub overridden: bool,
}

/// `%APPDATA%\Pioneer\rekordboxAgent\storage\options.json`
pub fn options_json_path() -> Option<PathBuf> {
    let appdata = std::env::var_os("APPDATA")?;
    Some(PathBuf::from(appdata).join(r"Pioneer\rekordboxAgent\storage\options.json"))
}

/// Resolve the library location. `db_override` (from settings) wins over options.json.
pub fn locate(db_override: Option<&Path>) -> Result<Location, Error> {
    let options = match options_json_path().map(std::fs::read_to_string) {
        Some(Ok(s)) => Some(s),
        Some(Err(e)) if e.kind() != std::io::ErrorKind::NotFound && db_override.is_none() => {
            return Err(Error::Invalid(format!(
                "cannot read rekordbox options.json: {e}"
            )));
        }
        _ => None,
    };
    resolve(options.as_deref(), db_override)
}

fn resolve(options_json: Option<&str>, db_override: Option<&Path>) -> Result<Location, Error> {
    // With an override, options.json describes another library: ignore it entirely.
    let opts = match (options_json, db_override) {
        (Some(json), None) => parse_options(json)?,
        _ => Options::default(),
    };
    let (db_path, overridden, analysis_root) = match db_override {
        // Default rekordbox layout: <dir of master.db>\share
        Some(p) => (p.to_path_buf(), true, p.parent().map(|d| d.join("share"))),
        None => (
            opts.db_path.ok_or_else(|| {
                Error::NotFound(
                    "rekordbox library not found: options.json is missing or has no db-path. \
                     Set the master.db path in Settings."
                        .into(),
                )
            })?,
            false,
            opts.analysis_root,
        ),
    };
    if !db_path.is_file() {
        return Err(Error::NotFound(format!(
            "rekordbox database not found at {}",
            db_path.display()
        )));
    }
    Ok(Location {
        analysis_root,
        db_path,
        overridden,
    })
}

#[derive(Default)]
struct Options {
    analysis_root: Option<PathBuf>,
    db_path: Option<PathBuf>,
}

/// options.json looks like `{"options": [["db-path", "C:\..."], ...], ...}`.
fn parse_options(json: &str) -> Result<Options, Error> {
    let v: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| Error::Invalid(format!("rekordbox options.json: {e}")))?;
    let mut out = Options::default();
    for pair in v["options"].as_array().into_iter().flatten() {
        let (Some(k), Some(val)) = (pair[0].as_str(), pair[1].as_str()) else {
            continue;
        };
        if val.is_empty() {
            continue;
        }
        match k {
            "analysis-data-root-path" => out.analysis_root = Some(val.into()),
            "db-path" => out.db_path = Some(val.into()),
            _ => {}
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A throwaway file that is deleted when dropped.
    struct TempDb(PathBuf);

    impl Drop for TempDb {
        fn drop(&mut self) {
            std::fs::remove_file(&self.0).ok();
        }
    }

    fn temp_db(name: &str) -> TempDb {
        let p = std::env::temp_dir().join(format!("mixmap-loc-{}-{name}.db", std::process::id()));
        std::fs::write(&p, b"x").unwrap();
        TempDb(p)
    }

    #[test]
    fn reads_db_and_analysis_path() {
        let db = temp_db("read");
        let json = serde_json::json!({"options": [
            ["db-path", db.0.to_str().unwrap()],
            ["analysis-data-root-path", r"C:\share"],
            ["lang", "de"]
        ]})
        .to_string();
        let loc = resolve(Some(&json), None).unwrap();
        assert_eq!(loc.db_path, db.0);
        assert_eq!(loc.analysis_root, Some(PathBuf::from(r"C:\share")));
        assert!(!loc.overridden);
    }

    #[test]
    fn override_wins_and_ignores_options_json() {
        let db = temp_db("override");
        for json in [
            r#"{"options": [["db-path", "C:\\nope\\master.db"], ["analysis-data-root-path", "C:\\x"]]}"#,
            "broken",
        ] {
            let loc = resolve(Some(json), Some(&db.0)).unwrap();
            assert_eq!(loc.db_path, db.0);
            assert_eq!(loc.analysis_root, db.0.parent().map(|d| d.join("share")));
            assert!(loc.overridden);
        }
    }

    #[test]
    fn empty_values_are_missing() {
        let err = resolve(Some(r#"{"options": [["db-path", ""]]}"#), None).unwrap_err();
        assert!(err.to_string().contains("Settings"), "{err}");
    }

    #[test]
    fn clear_errors() {
        let err = resolve(None, None).unwrap_err().to_string();
        assert!(err.contains("Settings"), "{err}");
        let err = resolve(
            Some(r#"{"options": [["db-path", "C:\\nope\\master.db"]]}"#),
            None,
        )
        .unwrap_err()
        .to_string();
        assert!(err.contains(r"C:\nope\master.db"), "{err}");
        assert!(resolve(Some("not json"), None).is_err());
    }
}
