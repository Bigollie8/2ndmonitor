//! User preset store for the MilkDrop visualizer.
//!
//! `<app_data_dir>/presets/` holds Butterchurn preset `.json` files
//! (pre-converted MilkDrop 2 presets) and raw `.milk` files (converted
//! best-effort in the frontend). Listed and read on demand by the picker.

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};

#[derive(Debug, Clone, Serialize)]
pub struct UserPreset {
    pub name: String,
    pub file: String,
    pub ext: String,
}

pub(crate) fn presets_dir<R: Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?
        .join("presets");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create presets dir: {e}"))?;
    Ok(dir)
}

/// Reject anything that could escape the presets dir. Filenames only.
pub(crate) fn is_safe_name(name: &str) -> bool {
    !name.is_empty()
        && !name.contains(['/', '\\'])
        && !name.contains("..")
        && !name.starts_with('.')
}

#[tauri::command]
pub fn presets_list<R: Runtime>(app: AppHandle<R>) -> Result<Vec<UserPreset>, String> {
    let dir = presets_dir(&app)?;
    let mut out = Vec::new();
    let entries = std::fs::read_dir(&dir).map_err(|e| format!("read presets dir: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = match path.extension().and_then(|e| e.to_str()) {
            Some(e) if e.eq_ignore_ascii_case("json") => "json",
            Some(e) if e.eq_ignore_ascii_case("milk") => "milk",
            _ => continue,
        };
        let file = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        let name = path
            .file_stem()
            .and_then(|n| n.to_str())
            .unwrap_or(&file)
            .to_string();
        out.push(UserPreset { name, file, ext: ext.to_string() });
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

#[tauri::command]
pub fn presets_read<R: Runtime>(app: AppHandle<R>, file: String) -> Result<String, String> {
    if !is_safe_name(&file) {
        return Err("invalid preset filename".into());
    }
    let path = presets_dir(&app)?.join(&file);
    std::fs::read_to_string(&path).map_err(|e| format!("read {file}: {e}"))
}

/// A marketplace-installed preset, listed from `<app_data>/presets/marketplace/<id>/`.
/// Distinct from `UserPreset` (hand-dropped/converted files listed by
/// `presets_list`): these have manifest-derived identity (name/author/version)
/// and are installed/uninstalled through the marketplace commands.
#[derive(Debug, Clone, Serialize)]
pub struct MarketPreset {
    pub id: String,
    pub name: String,
    pub author: Option<String>,
    pub version: String,
}

fn market_dir<R: Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, String> {
    let dir = presets_dir(app)?.join("marketplace");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create marketplace presets dir: {e}"))?;
    Ok(dir)
}

/// Folder ids are also used in paths; same shape as marketplace.rs's and
/// visualizers.rs's own copies — kept as a third local copy per the existing
/// pattern rather than unifying them.
fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// Pure core of presets_market_list: walk `market_dir`'s subfolders, admit
/// only folders with a valid installed.json marker (same corrupt-marker rule
/// as visualizers.rs::folder_source), read name/author/version from
/// manifest.json with id fallbacks.
fn market_entries(market_dir: &std::path::Path) -> Vec<MarketPreset> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(market_dir) else { return out; };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() { continue; }
        let Some(id) = path.file_name().and_then(|n| n.to_str()).map(String::from) else { continue; };
        if !is_safe_id(&id) { continue; }
        // Marketplace provenance requires a valid marker — same rule as
        // visualizers.rs::folder_source; a corrupt marker must not confer it.
        let has_marker = std::fs::read_to_string(path.join("installed.json"))
            .ok()
            .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
            .is_some_and(|v| v.is_object());
        if !has_marker { continue; }
        let manifest = std::fs::read_to_string(path.join("manifest.json"))
            .ok()
            .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok());
        let (name, author, version) = match &manifest {
            Some(v) => (
                v.get("name").and_then(|s| s.as_str()).unwrap_or(&id).to_string(),
                v.get("author").and_then(|s| s.as_str()).map(String::from),
                v.get("version").and_then(|s| s.as_str()).unwrap_or("").to_string(),
            ),
            None => (id.clone(), None, String::new()),
        };
        out.push(MarketPreset { id, name, author, version });
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

#[tauri::command]
pub fn presets_market_list<R: Runtime>(app: AppHandle<R>) -> Result<Vec<MarketPreset>, String> {
    Ok(market_entries(&market_dir(&app)?))
}

#[tauri::command]
pub fn presets_market_read<R: Runtime>(app: AppHandle<R>, id: String) -> Result<String, String> {
    if !is_safe_id(&id) {
        return Err("invalid preset id".into());
    }
    let path = market_dir(&app)?.join(&id).join("preset.json");
    std::fs::read_to_string(&path).map_err(|e| format!("read {id}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::{is_safe_name, market_entries};
    use serde_json::json;

    #[test]
    fn accepts_normal_filenames() {
        assert!(is_safe_name("Geiss - Reflection.json"));
        assert!(is_safe_name("preset.milk"));
    }

    #[test]
    fn rejects_traversal_and_paths() {
        assert!(!is_safe_name("../tweaks.json"));
        assert!(!is_safe_name("..\\secrets\\x.json"));
        assert!(!is_safe_name("sub/dir.json"));
        assert!(!is_safe_name(""));
        assert!(!is_safe_name(".hidden"));
    }

    /// A fresh, uniquely-named scratch dir under the OS temp dir, cleaned up
    /// on drop. Copied from visualizers.rs's test module (same rationale:
    /// avoid a tempfile dependency while still exercising real files).
    struct ScratchDir(std::path::PathBuf);
    impl ScratchDir {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "2ndmonitor-presets-test-{tag}-{:?}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            ScratchDir(dir)
        }
    }
    impl Drop for ScratchDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn market_entries_empty_for_missing_dir() {
        let dir = std::env::temp_dir().join("2ndmonitor-presets-test-nonexistent-does-not-exist");
        let _ = std::fs::remove_dir_all(&dir); // just in case a prior run left it
        assert!(market_entries(&dir).is_empty());
    }

    #[test]
    fn market_entries_requires_valid_marker() {
        let d = ScratchDir::new("no-marker");
        let sub = d.0.join("geiss-reflection");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(
            sub.join("manifest.json"),
            json!({"id": "geiss-reflection", "name": "Geiss - Reflection", "author": "Geiss", "version": "1.0.0", "api": 1, "permissions": []}).to_string(),
        )
        .unwrap();
        std::fs::write(sub.join("preset.json"), "{}").unwrap();
        // No installed.json at all.
        assert!(market_entries(&d.0).is_empty());

        // installed.json present but not valid JSON.
        std::fs::write(sub.join("installed.json"), "not json").unwrap();
        assert!(market_entries(&d.0).is_empty());
    }

    #[test]
    fn market_entries_reads_manifest_fields() {
        let d = ScratchDir::new("good-manifest");
        let sub = d.0.join("geiss-reflection");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(
            sub.join("manifest.json"),
            json!({"id": "geiss-reflection", "name": "Geiss - Reflection", "author": "Geiss", "version": "1.0.0", "api": 1, "permissions": []}).to_string(),
        )
        .unwrap();
        std::fs::write(sub.join("preset.json"), "{}").unwrap();
        std::fs::write(sub.join("installed.json"), json!({"id": "geiss-reflection", "version": "1.0.0", "kind": "preset", "installed_at": 1}).to_string()).unwrap();

        let entries = market_entries(&d.0);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, "geiss-reflection");
        assert_eq!(entries[0].name, "Geiss - Reflection");
        assert_eq!(entries[0].author, Some("Geiss".to_string()));
        assert_eq!(entries[0].version, "1.0.0");
    }

    #[test]
    fn market_entries_falls_back_to_id_on_bad_manifest() {
        let d = ScratchDir::new("bad-manifest");
        let sub = d.0.join("some-preset");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(sub.join("manifest.json"), "not json").unwrap();
        std::fs::write(sub.join("preset.json"), "{}").unwrap();
        std::fs::write(sub.join("installed.json"), json!({"id": "some-preset", "version": "1.0.0", "kind": "preset", "installed_at": 1}).to_string()).unwrap();

        let entries = market_entries(&d.0);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, "some-preset");
        assert_eq!(entries[0].name, "some-preset");
        assert_eq!(entries[0].author, None);
        assert_eq!(entries[0].version, "");
    }

    #[test]
    fn market_entries_ignores_a_stray_file_that_isnt_a_directory() {
        // presets_list's own `!path.is_file()` skip is what keeps the
        // `marketplace/` subfolder out of "Your presets"; this test covers
        // market_entries's own half of the boundary — a file sitting next to
        // the marketplace subfolders must not be mistaken for one.
        let d = ScratchDir::new("stray-file");
        std::fs::write(d.0.join("not-a-folder.json"), "{}").unwrap();
        assert!(market_entries(&d.0).is_empty());
    }
}
