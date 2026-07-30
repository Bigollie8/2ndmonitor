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
//!
//! Seed filenames follow `<kind>/<id>-<version>.zip`, split on the LAST
//! hyphen (`parse_seed_path`), so an id MAY itself contain hyphens
//! (`tile-quote-1.0.0.zip` parses to id `tile-quote`, version `1.0.0`) but a
//! **version must never contain a hyphen** — there would be no way to tell
//! where the id ends and the version begins. `is_safe_version` enforces this
//! by excluding `-` from its charset, so the rightmost hyphen is always
//! unambiguously the id/version boundary.

use crate::marketplace::install_bundle_zip;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};

#[derive(Debug, PartialEq)]
pub struct SeedRef {
    pub path: PathBuf,
    pub kind: String,
    pub id: String,
    pub version: String,
}

fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// Same shape as `is_safe_id` but for the version segment of a seed filename
/// or a `seed_zip_for` argument — digits, lowercase letters and `.` only, no
/// `-` (see the module doc comment for why), no `/`, `\`, `..`, or a bare
/// `.`. This is what stands between `seed_zip_for` and an arbitrary file
/// read: `kind`, `id`, and `version` all end up `Path::join`-ed onto the
/// resources directory, and `version` in particular is a `String` that Task 6
/// wires straight from a remote-influenced marketplace index — a value like
/// `"../../../../Users/x/Desktop/secret"` would otherwise walk straight out
/// of `resources/seed` (an absolute value would discard the prefix
/// entirely). Reject rather than sanitise, same as `is_safe_id`.
///
/// The charset check alone does NOT reject `".."` or `"."` — both parse as
/// "lowercase | digit | '.'" — so it is the two explicit equality checks
/// below, not the charset, that make this function's guarantee true. Every
/// current call site only ever uses `version` concatenated inside
/// `format!("{id}-{version}.zip")` (see `seed_lookup_name`), which is safe
/// regardless: a bare `".."` there produces the literal filename `"id-..zip"`,
/// not a traversal. But that is a property of the CALL SITES, not of this
/// function, and this function's job is to make its own name true so the
/// next call site that uses `version` on its own doesn't have to re-derive
/// that reasoning from scratch.
fn is_safe_version(version: &str) -> bool {
    !version.is_empty()
        && version.len() <= 32
        && version != ".."
        && version != "."
        && version.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.')
}

/// `<kind>/<id>-<version>.zip`. Splits on the LAST '-' so an id containing a
/// hyphen (`tile-quote`) parses correctly. Requires a literal `.zip`
/// extension (case-insensitive) so a stray non-bundle file in the seed
/// directory (e.g. a README) is silently ignored here rather than read and
/// failing later as "bad zip".
pub fn parse_seed_path(p: &Path) -> Option<SeedRef> {
    let kind = p.parent()?.file_name()?.to_str()?;
    if kind != "tile" && kind != "visualizer" {
        return None;
    }
    let has_zip_ext = p.extension().map(|e| e.eq_ignore_ascii_case("zip")).unwrap_or(false);
    if !has_zip_ext {
        return None;
    }
    let stem = p.file_stem()?.to_str()?;
    let (id, version) = stem.rsplit_once('-')?;
    if !is_safe_id(id) || !is_safe_version(version) {
        return None;
    }
    Some(SeedRef {
        path: p.to_path_buf(),
        kind: kind.to_string(),
        id: id.to_string(),
        version: version.to_string(),
    })
}

pub fn should_skip(removed: &[String], kind: &str, id: &str) -> bool {
    let key = format!("{kind}:{id}");
    removed.iter().any(|r| r == &key)
}

/// Decides which parsed seeds should actually be installed, given the raw
/// candidate paths found on disk. Pure — no filesystem or `AppHandle` access
/// — so it is unit-testable against a synthetic path list and a stub
/// `is_installed` closure, independent of `seed_sync`'s real directory walk.
/// This is also where the "never touch presets" guarantee is exercised in
/// tests: a `preset/...` path is dropped here by `parse_seed_path`'s kind
/// check, the same function `seed_sync` relies on structurally by only ever
/// walking `resources/seed/tile` and `resources/seed/visualizer`.
pub fn plan_seeds(
    paths: &[PathBuf],
    removed: &[String],
    is_installed: &dyn Fn(&str, &str) -> bool,
) -> Vec<SeedRef> {
    paths
        .iter()
        .filter_map(|p| parse_seed_path(p))
        .filter(|s| !should_skip(removed, &s.kind, &s.id))
        .filter(|s| !is_installed(&s.kind, &s.id))
        .collect()
}

fn seed_dir<R: Runtime>(app: &AppHandle<R>) -> Option<std::path::PathBuf> {
    app.path().resource_dir().ok().map(|d| d.join("resources/seed"))
}

/// The `<id>-<version>.zip` naming rule, in one place. Mirrors the filename
/// shape `parse_seed_path` reads on disk; `seed_zip_for` calls this rather
/// than repeating the `format!` inline so there is exactly one definition of
/// "what a seed file is called" to keep in sync with `parse_seed_path`.
pub fn seed_lookup_name(id: &str, version: &str) -> String {
    format!("{id}-{version}.zip")
}

/// Returns the seed zip bytes for an exact id@version, if one ships.
///
/// `kind`, `id`, and `version` are all validated before being joined onto the
/// resources path — none of the three are caller-trusted. `version` is the
/// one that matters most: Task 6 wires this to a `version` string that can
/// come straight from the marketplace index, and `version` has never before
/// been used as a path component anywhere in this codebase (elsewhere it
/// only appears in a URL or in JSON), so this is the first place that
/// invariant needs to be enforced rather than assumed.
pub fn seed_zip_for<R: Runtime>(
    app: &AppHandle<R>, kind: &str, id: &str, version: &str,
) -> Option<Vec<u8>> {
    if kind != "tile" && kind != "visualizer" {
        return None;
    }
    if !is_safe_id(id) || !is_safe_version(version) {
        return None;
    }
    let dir = seed_dir(app)?;
    std::fs::read(dir.join(kind).join(seed_lookup_name(id, version))).ok()
}

/// Installs every seed bundle that is not already installed and not in
/// `removed`. Non-fatal: a failure on one seed is logged and the rest
/// proceed — the app must boot even if every seed fails. Returns the keys
/// installed.
///
/// Only ever walks `resources/seed/tile` and `resources/seed/visualizer`
/// (never `preset`): `marketplace::is_installed` always returns false for
/// `kind == "preset"` (presets have no per-id directory or marker), so a
/// naive "if not installed, install" over presets would re-write and clobber
/// a user's edited preset file on every launch. `plan_seeds` additionally
/// enforces this via `parse_seed_path`'s kind check, so the constraint holds
/// even if this loop were ever accidentally widened.
#[tauri::command]
pub fn seed_sync<R: Runtime>(app: AppHandle<R>, removed: Vec<String>) -> Result<Vec<String>, String> {
    let Some(dir) = seed_dir(&app) else { return Ok(vec![]) };

    // A missing kind subdirectory is the normal state before any seeds of
    // that kind ship (e.g. this task ships resources/seed empty save for
    // .gitkeep) — not an error, but logged anyway since a *misspelled*
    // directory would look identical and otherwise fail completely silently.
    let mut paths = Vec::new();
    for kind in ["tile", "visualizer"] {
        match std::fs::read_dir(dir.join(kind)) {
            Ok(entries) => {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if parse_seed_path(&path).is_none() {
                        eprintln!(
                            "seed_sync: skipping {} — does not match <id>-<version>.zip",
                            path.display()
                        );
                        continue;
                    }
                    paths.push(path);
                }
            }
            Err(e) => eprintln!("seed_sync: no {kind} seeds shipped ({e})"),
        }
    }

    let is_installed = |kind: &str, id: &str| crate::marketplace::is_installed(&app, kind, id);
    let to_install = plan_seeds(&paths, &removed, &is_installed);

    let mut installed = Vec::new();
    for s in to_install {
        let bytes = match std::fs::read(&s.path) {
            Ok(b) => b,
            Err(e) => {
                eprintln!("seed_sync: failed to read {}: {e}", s.path.display());
                continue;
            }
        };
        match install_bundle_zip(&app, &s.kind, &s.id, &s.version, &bytes, "seed") {
            Ok(()) => installed.push(format!("{}:{}", s.kind, s.id)),
            Err(e) => eprintln!("seed_sync: {}:{} failed: {e}", s.kind, s.id),
        }
    }
    Ok(installed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seed_filename_parses_kind_id_version() {
        let p = Path::new("visualizer/aurora-1.0.0.zip");
        let s = parse_seed_path(p).unwrap();
        assert_eq!(s.kind, "visualizer");
        assert_eq!(s.id, "aurora");
        assert_eq!(s.version, "1.0.0");
    }

    #[test]
    fn seed_filename_rejects_unsafe_id() {
        // Bails at kind extraction — `Path::parent().file_name()` returns
        // None for a path ending in `..` — so this never reaches
        // `is_safe_id`. Kept as coverage of that early-return.
        assert!(parse_seed_path(Path::new("visualizer/../etc-1.0.0.zip")).is_none());
        assert!(parse_seed_path(Path::new("visualizer/A B-1.0.0.zip")).is_none());
        // A valid kind with a traversal-shaped stem: this is the case that
        // actually reaches `is_safe_id` (id = "..") and is rejected there.
        assert!(parse_seed_path(Path::new("tile/..-1.0.0.zip")).is_none());
    }

    #[test]
    fn seed_filename_rejects_unknown_kind() {
        assert!(parse_seed_path(Path::new("preset/x-1.0.0.zip")).is_none());
    }

    #[test]
    fn seed_filename_requires_a_zip_extension() {
        assert!(parse_seed_path(Path::new("tile/aurora-1.0.0.txt")).is_none());
        assert!(parse_seed_path(Path::new("tile/aurora-1.0.0")).is_none());
        // Case-insensitive is fine.
        assert!(parse_seed_path(Path::new("tile/aurora-1.0.0.ZIP")).is_some());
    }

    #[test]
    fn seed_filename_last_hyphen_is_the_id_version_boundary() {
        // A version may never contain a hyphen (see module docs), so a
        // hyphenated id like `aurora-2` parses correctly by construction:
        // the rightmost hyphen is always the boundary.
        let s = parse_seed_path(Path::new("tile/aurora-2-1.zip")).unwrap();
        assert_eq!(s.id, "aurora-2");
        assert_eq!(s.version, "1");
    }

    #[test]
    fn removed_keys_are_skipped() {
        let removed = vec!["visualizer:aurora".to_string()];
        assert!(should_skip(&removed, "visualizer", "aurora"));
        assert!(!should_skip(&removed, "tile", "aurora"));
        assert!(!should_skip(&removed, "visualizer", "liquid"));
    }

    #[test]
    fn seed_zip_for_version_charset_blocks_path_traversal() {
        // This is the actual fix for the arbitrary-read: `version` reaches
        // `Path::join` in `seed_zip_for` unless rejected here first.
        assert!(!is_safe_version("../../../etc"));
        assert!(!is_safe_version("1.0.0/../../x"));
        assert!(!is_safe_version(""));
        assert!(!is_safe_version("1.0.0-beta")); // hyphens excluded by design
        assert!(!is_safe_version("1.0.0\\evil"));
        assert!(is_safe_version("1.0.0"));
    }

    #[test]
    fn is_safe_version_rejects_bare_dot_and_dot_dot() {
        // The charset alone (lowercase | digit | '.') accepts both of these —
        // it's the explicit equality checks that make the docstring's "no .."
        // claim true. Regression test for the whole-branch review's Important
        // 3: the docstring advertised this guarantee before the code gave it.
        assert!(!is_safe_version(".."));
        assert!(!is_safe_version("."));
    }

    #[test]
    fn seed_fallback_only_applies_to_an_exact_version_match() {
        // seed_zip_for is keyed on id AND version: a seeded 1.0.0 must not satisfy
        // a request for 1.1.0, or a user would silently get stale content when the
        // network blips during an update.
        assert_eq!(seed_lookup_name("aurora", "1.0.0"), "aurora-1.0.0.zip");
        assert_ne!(seed_lookup_name("aurora", "1.1.0"), "aurora-1.0.0.zip");
    }

    #[test]
    fn plan_seeds_filters_presets_removed_installed_and_malformed() {
        let paths = vec![
            PathBuf::from("tile/quote-1.0.0.zip"),        // kept
            PathBuf::from("visualizer/aurora-1.0.0.zip"),  // removed by the user
            PathBuf::from("visualizer/liquid-1.0.0.zip"),  // already installed
            PathBuf::from("preset/classic-1.0.0.zip"),     // wrong kind — never a seed target
            PathBuf::from("tile/bad name-1.0.0.zip"),      // malformed id (space)
            PathBuf::from("tile/no-extension"),            // malformed (no .zip)
        ];
        let removed = vec!["visualizer:aurora".to_string()];
        let is_installed = |kind: &str, id: &str| kind == "visualizer" && id == "liquid";

        let planned = plan_seeds(&paths, &removed, &is_installed);

        assert_eq!(planned.len(), 1, "{planned:?}");
        assert_eq!(planned[0].kind, "tile");
        assert_eq!(planned[0].id, "quote");
        assert_eq!(planned[0].version, "1.0.0");
    }
}
