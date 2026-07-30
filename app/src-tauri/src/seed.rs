//! Ships the base content set as real bundles and installs them on first run.
//!
//! The point of seeding is that "official" content stops being a privileged
//! tier: it is ordinary bundle content that merely happens to arrive with the
//! app. Removal therefore deletes it like anything else, and reinstalling it
//! works with no network because the zip is still in resources.
//!
//! Seeds get NO privileged install path — they go through
//! `marketplace::install_bundle_zip`, the same allowlist and validation as a
//! download.

use crate::marketplace::install_bundle_zip;
use std::path::Path;
use tauri::{AppHandle, Manager, Runtime};

pub struct SeedRef {
    pub kind: String,
    pub id: String,
    pub version: String,
}

fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// `<kind>/<id>-<version>.zip`. Splits on the LAST '-' so an id containing a
/// hyphen (`tile-quote`) parses correctly.
pub fn parse_seed_path(p: &Path) -> Option<SeedRef> {
    let kind = p.parent()?.file_name()?.to_str()?;
    if kind != "tile" && kind != "visualizer" {
        return None;
    }
    let stem = p.file_stem()?.to_str()?;
    let (id, version) = stem.rsplit_once('-')?;
    if !is_safe_id(id) || version.is_empty() {
        return None;
    }
    Some(SeedRef { kind: kind.to_string(), id: id.to_string(), version: version.to_string() })
}

pub fn should_skip(removed: &[String], kind: &str, id: &str) -> bool {
    let key = format!("{kind}:{id}");
    removed.iter().any(|r| r == &key)
}

fn seed_dir<R: Runtime>(app: &AppHandle<R>) -> Option<std::path::PathBuf> {
    app.path().resource_dir().ok().map(|d| d.join("resources/seed"))
}

/// Returns the seed zip bytes for an exact id@version, if one ships.
pub fn seed_zip_for<R: Runtime>(
    app: &AppHandle<R>, kind: &str, id: &str, version: &str,
) -> Option<Vec<u8>> {
    if !is_safe_id(id) {
        return None;
    }
    let dir = seed_dir(app)?;
    std::fs::read(dir.join(kind).join(format!("{id}-{version}.zip"))).ok()
}

/// Installs every seed bundle that is not already installed and not in
/// `removed`. Non-fatal: a failure on one seed is logged and the rest proceed.
/// Returns the keys installed.
///
/// Only ever iterates `tile` and `visualizer` — `parse_seed_path` enforces
/// this. Presets are deliberately excluded: `marketplace::is_installed`
/// always returns false for that kind (presets have no per-id directory or
/// marker), so a naive "if not installed, install" over presets would
/// re-write and clobber a user's edited preset file on every launch.
#[tauri::command]
pub fn seed_sync<R: Runtime>(app: AppHandle<R>, removed: Vec<String>) -> Result<Vec<String>, String> {
    let Some(dir) = seed_dir(&app) else { return Ok(vec![]) };
    let mut installed = Vec::new();
    for kind in ["tile", "visualizer"] {
        let Ok(entries) = std::fs::read_dir(dir.join(kind)) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(s) = parse_seed_path(&path) else { continue };
            if should_skip(&removed, &s.kind, &s.id) {
                continue;
            }
            if crate::marketplace::is_installed(&app, &s.kind, &s.id) {
                continue;
            }
            let Ok(bytes) = std::fs::read(&path) else { continue };
            match install_bundle_zip(&app, &s.kind, &s.id, &s.version, &bytes, "seed") {
                Ok(()) => installed.push(format!("{}:{}", s.kind, s.id)),
                Err(e) => eprintln!("seed_sync: {}:{} failed: {e}", s.kind, s.id),
            }
        }
    }
    Ok(installed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seed_filename_parses_kind_id_version() {
        let p = std::path::Path::new("visualizer/aurora-1.0.0.zip");
        let s = parse_seed_path(p).unwrap();
        assert_eq!(s.kind, "visualizer");
        assert_eq!(s.id, "aurora");
        assert_eq!(s.version, "1.0.0");
    }

    #[test]
    fn seed_filename_rejects_unsafe_id() {
        assert!(parse_seed_path(std::path::Path::new("visualizer/../etc-1.0.0.zip")).is_none());
        assert!(parse_seed_path(std::path::Path::new("visualizer/A B-1.0.0.zip")).is_none());
    }

    #[test]
    fn seed_filename_rejects_unknown_kind() {
        assert!(parse_seed_path(std::path::Path::new("preset/x-1.0.0.zip")).is_none());
    }

    #[test]
    fn removed_keys_are_skipped() {
        let removed = vec!["visualizer:aurora".to_string()];
        assert!(should_skip(&removed, "visualizer", "aurora"));
        assert!(!should_skip(&removed, "tile", "aurora"));
        assert!(!should_skip(&removed, "visualizer", "liquid"));
    }
}
