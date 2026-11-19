//! Automatic backups (`%APPDATA%\mixmap\backups\*.mixmap.json`) written before
//! destructive actions (import "replace", reset). The content is produced by the UI.

use std::path::{Path, PathBuf};

use crate::Error;

/// A plain file name ending in `.mixmap.json`: letters, digits, `-`, `_`, `.` only,
/// so it can never leave the backups folder.
fn check_name(name: &str) -> Result<(), Error> {
    let ok = name.ends_with(".mixmap.json")
        && !name.starts_with('.')
        && name.len() <= 128
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    if ok {
        Ok(())
    } else {
        Err(Error::Invalid(format!(
            "invalid backup file name: {name:?}"
        )))
    }
}

/// Write `content` to `dir/name` (creating `dir`), via a temporary file so a crash
/// never leaves a half-written backup. Returns the full path.
pub fn write_backup(dir: &Path, name: &str, content: &str) -> Result<PathBuf, Error> {
    check_name(name)?;
    std::fs::create_dir_all(dir)
        .map_err(|e| Error::Invalid(format!("cannot create {}: {e}", dir.display())))?;
    let path = dir.join(name);
    let tmp = dir.join(format!("{name}.tmp"));
    std::fs::write(&tmp, content)
        .map_err(|e| Error::Invalid(format!("cannot write {}: {e}", tmp.display())))?;
    std::fs::rename(&tmp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        Error::Invalid(format!("cannot write {}: {e}", path.display()))
    })?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("mixmap-backups-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn writes_into_a_new_folder() {
        let dir = temp_dir("write");
        let path = write_backup(&dir, "backup-2026-11-15-100000.mixmap.json", "{}").unwrap();
        assert_eq!(path, dir.join("backup-2026-11-15-100000.mixmap.json"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{}");
        // No temporary file left behind.
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rejects_names_that_could_escape_the_folder() {
        let dir = temp_dir("reject");
        for bad in [
            "../x.mixmap.json",
            r"..\x.mixmap.json",
            "a/b.mixmap.json",
            "C:x.mixmap.json",
            "x.json",
            ".mixmap.json",
            "",
        ] {
            assert!(write_backup(&dir, bad, "{}").is_err(), "{bad} accepted");
        }
        assert!(!dir.exists());
    }
}
