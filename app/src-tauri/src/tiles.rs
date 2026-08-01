//! Declarative-tile store: `<app_data_dir>/tiles/<id>/` folders each holding
//! `manifest.json` + `view.json`. Tiles are installed from the marketplace
//! only — there is no in-app authoring surface in this phase, so unlike
//! visualizers.rs there is no `tiles_write` command. A std-only polling
//! watcher (2s) emits `tiles:changed` whenever anything under the dir
//! changes, driving hot reload — polling avoids a native watcher dependency
//! and 2s latency is fine for a save-and-glance workflow.

use serde::Serialize;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter, Manager, Runtime};

#[derive(Debug, Clone, Serialize)]
pub struct TileFolder {
    pub id: String,
    pub name: String,
    pub author: Option<String>,
    pub version: String,
    pub api: Option<u64>,
    /// Set when manifest.json is missing/unparsable/invalid — listed so the UI
    /// can show the folder with an explanatory badge instead of hiding it.
    pub manifest_error: Option<String>,
    /// "marketplace" when an `installed.json` marker (written by
    /// `marketplace_install`) exists in the folder, else "local". A corrupt or
    /// non-object marker never confers marketplace provenance.
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TileSource {
    pub manifest: String,
    pub view: String,
}

fn tiles_dir<R: Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?
        .join("tiles");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create tiles dir: {e}"))?;
    Ok(dir)
}

/// Folder ids are also used in paths; same shape the frontend manifest
/// validator enforces (`[a-z0-9-]{1,64}`).
fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// "marketplace" iff `installed.json` exists in the folder and parses as a
/// JSON object; anything else — missing, unreadable, malformed — is "local".
/// A corrupt marker must not confer marketplace provenance.
fn folder_source(path: &std::path::Path) -> String {
    let is_marketplace = std::fs::read_to_string(path.join("installed.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .is_some_and(|v| v.is_object());
    if is_marketplace { "marketplace" } else { "local" }.to_string()
}

/// Full manifest validation beyond "it parses as JSON" — each rule gets its
/// own specific message rather than a generic "invalid manifest", so a
/// half-written or corrupted install is diagnosable from the badge alone.
/// Mirrors `validate_folder` in visualizers.rs, restricted to the fields the
/// Rust side can check cheaply: id/name/version/api and the presence of
/// `view.json`.
fn validate_folder(v: &serde_json::Value, folder_id: &str, dir: &std::path::Path) -> Option<String> {
    let manifest_id = match v.get("id").and_then(|s| s.as_str()) {
        Some(s) => s,
        None => return Some("manifest.json: \"id\" must be a string".to_string()),
    };
    if !is_safe_id(manifest_id) {
        return Some(format!(
            "manifest.json: id {manifest_id:?} must be 1-64 chars of [a-z0-9-]"
        ));
    }
    if manifest_id != folder_id {
        return Some(format!(
            "manifest.json: id {manifest_id:?} does not match folder name {folder_id:?}"
        ));
    }
    let has_name = v
        .get("name")
        .and_then(|n| n.as_str())
        .is_some_and(|s| !s.trim().is_empty());
    if !has_name {
        return Some("manifest.json: \"name\" is required".to_string());
    }
    let has_version = v
        .get("version")
        .and_then(|s| s.as_str())
        .is_some_and(|s| !s.trim().is_empty());
    if !has_version {
        return Some("manifest.json: \"version\" is required".to_string());
    }
    if v.get("api").and_then(|a| a.as_u64()) != Some(1) {
        return Some("manifest.json: \"api\" must be 1".to_string());
    }
    if !dir.join("view.json").is_file() {
        return Some("view.json is missing".to_string());
    }
    None
}

fn folder_entry(path: &std::path::Path, id: String) -> TileFolder {
    let source = folder_source(path);
    let manifest_path = path.join("manifest.json");
    let text = match std::fs::read_to_string(&manifest_path) {
        Ok(t) => t,
        Err(e) => {
            return TileFolder {
                id: id.clone(),
                name: id,
                author: None,
                version: String::new(),
                api: None,
                manifest_error: Some(format!("manifest.json unreadable: {e}")),
                source,
            }
        }
    };
    let v = match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(v) => v,
        Err(e) => {
            return TileFolder {
                id: id.clone(),
                name: id,
                author: None,
                version: String::new(),
                api: None,
                manifest_error: Some(format!("manifest.json invalid: {e}")),
                source,
            }
        }
    };

    let name = v.get("name").and_then(|n| n.as_str()).unwrap_or(&id).to_string();
    let author = v.get("author").and_then(|a| a.as_str()).map(String::from);
    let version = v
        .get("version")
        .and_then(|s| s.as_str())
        .unwrap_or("")
        .to_string();
    let api = v.get("api").and_then(|a| a.as_u64());
    let manifest_error = validate_folder(&v, &id, path);

    TileFolder {
        name,
        author,
        version,
        api,
        manifest_error,
        id,
        source,
    }
}

#[tauri::command]
pub fn tiles_list<R: Runtime>(app: AppHandle<R>) -> Result<Vec<TileFolder>, String> {
    let dir = tiles_dir(&app)?;
    let mut out = Vec::new();
    let entries = std::fs::read_dir(&dir).map_err(|e| format!("read tiles dir: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(id) = path.file_name().and_then(|n| n.to_str()).map(String::from) else {
            continue;
        };
        if !is_safe_id(&id) {
            continue;
        }
        out.push(folder_entry(&path, id));
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

#[tauri::command]
pub fn tiles_read<R: Runtime>(app: AppHandle<R>, id: String) -> Result<TileSource, String> {
    if !is_safe_id(&id) {
        return Err("invalid tile id".into());
    }
    let dir = tiles_dir(&app)?.join(&id);
    let manifest = std::fs::read_to_string(dir.join("manifest.json"))
        .map_err(|e| format!("read manifest: {e}"))?;
    let view =
        std::fs::read_to_string(dir.join("view.json")).map_err(|e| format!("read view.json: {e}"))?;
    Ok(TileSource { manifest, view })
}

/// Cheap change fingerprint: count + max mtime over every file two levels
/// deep. Rename/edit/delete all move it.
fn fingerprint(dir: &std::path::Path) -> (usize, SystemTime) {
    let mut count = 0usize;
    let mut newest = SystemTime::UNIX_EPOCH;
    let Ok(entries) = std::fs::read_dir(dir) else {
        return (0, newest);
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Ok(inner) = std::fs::read_dir(&path) {
                for f in inner.flatten() {
                    count += 1;
                    if let Ok(meta) = f.metadata() {
                        if let Ok(m) = meta.modified() {
                            if m > newest {
                                newest = m;
                            }
                        }
                    }
                }
            }
        }
        count += 1;
    }
    (count, newest)
}

pub fn spawn_watcher<R: Runtime>(app: AppHandle<R>) {
    std::thread::spawn(move || {
        let Ok(dir) = tiles_dir(&app) else {
            eprintln!("tiles watcher disabled: no app data dir");
            return;
        };
        let mut last = fingerprint(&dir);
        loop {
            std::thread::sleep(Duration::from_secs(2));
            let now = fingerprint(&dir);
            if now != last {
                last = now;
                let _ = app.emit("tiles:changed", ());
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{folder_entry, folder_source, is_safe_id, validate_folder};
    use serde_json::json;

    #[test]
    fn accepts_normal_ids() {
        assert!(is_safe_id("my-tile1"));
        assert!(is_safe_id("a"));
    }

    #[test]
    fn rejects_unsafe_ids() {
        assert!(!is_safe_id("../x"));
        assert!(!is_safe_id("a b"));
        assert!(!is_safe_id(""));
        assert!(!is_safe_id("UPPER"));
        assert!(!is_safe_id("dot.dot"));
        assert!(!is_safe_id(&"x".repeat(65)));
    }

    /// A fresh, uniquely-named scratch dir under the OS temp dir, cleaned up
    /// on drop. Avoids a tempfile dependency (none is in Cargo.toml and this
    /// task adds none) while still exercising folder_entry against real files.
    struct ScratchDir(std::path::PathBuf);
    impl ScratchDir {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "2ndmonitor-tile-test-{tag}-{:?}",
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
    fn folder_source_defaults_to_local_without_a_marker() {
        let d = ScratchDir::new("no-marker");
        assert_eq!(folder_source(&d.0), "local");
    }

    #[test]
    fn folder_source_is_marketplace_with_a_valid_marker() {
        let d = ScratchDir::new("marker");
        std::fs::write(
            d.0.join("installed.json"),
            json!({"id": "x", "version": "1.0.0", "kind": "tile", "installed_at": 1}).to_string(),
        )
        .unwrap();
        assert_eq!(folder_source(&d.0), "marketplace");
    }

    #[test]
    fn folder_source_falls_back_to_local_on_a_corrupt_marker() {
        let d = ScratchDir::new("corrupt-marker");
        std::fs::write(d.0.join("installed.json"), "not json").unwrap();
        assert_eq!(folder_source(&d.0), "local");
    }

    #[test]
    fn folder_source_falls_back_to_local_on_a_non_object_marker() {
        let d = ScratchDir::new("non-object-marker");
        std::fs::write(d.0.join("installed.json"), "[1,2,3]").unwrap();
        assert_eq!(folder_source(&d.0), "local");
    }

    #[test]
    fn validate_folder_rejects_id_folder_mismatch() {
        let d = ScratchDir::new("mismatch");
        std::fs::write(d.0.join("view.json"), "{}").unwrap();
        let v = json!({"id": "other", "name": "N", "version": "1.0.0", "api": 1});
        let err = validate_folder(&v, "mine", &d.0).unwrap();
        assert!(err.contains("does not match folder name"), "{err}");
    }

    #[test]
    fn validate_folder_rejects_missing_payload_file() {
        let d = ScratchDir::new("no-viewjson");
        let v = json!({"id": "mine", "name": "N", "version": "1.0.0", "api": 1});
        let err = validate_folder(&v, "mine", &d.0).unwrap();
        assert_eq!(err, "view.json is missing");
    }

    #[test]
    fn validate_folder_rejects_wrong_api() {
        let d = ScratchDir::new("bad-api");
        std::fs::write(d.0.join("view.json"), "{}").unwrap();
        let v = json!({"id": "mine", "name": "N", "version": "1.0.0", "api": 2});
        let err = validate_folder(&v, "mine", &d.0).unwrap();
        assert_eq!(err, "manifest.json: \"api\" must be 1");
    }

    #[test]
    fn validate_folder_rejects_missing_name() {
        let d = ScratchDir::new("no-name");
        std::fs::write(d.0.join("view.json"), "{}").unwrap();
        let v = json!({"id": "mine", "name": "  ", "version": "1.0.0", "api": 1});
        let err = validate_folder(&v, "mine", &d.0).unwrap();
        assert_eq!(err, "manifest.json: \"name\" is required");
    }

    #[test]
    fn validate_folder_rejects_missing_version() {
        let d = ScratchDir::new("no-version");
        std::fs::write(d.0.join("view.json"), "{}").unwrap();
        let v = json!({"id": "mine", "name": "N", "version": "", "api": 1});
        let err = validate_folder(&v, "mine", &d.0).unwrap();
        assert_eq!(err, "manifest.json: \"version\" is required");
    }

    #[test]
    fn validate_folder_rejects_bad_id_shape() {
        let d = ScratchDir::new("bad-id-shape");
        std::fs::write(d.0.join("view.json"), "{}").unwrap();
        let v = json!({"id": "MY TILE", "name": "N", "version": "1.0.0", "api": 1});
        let err = validate_folder(&v, "MY TILE", &d.0).unwrap();
        assert!(err.contains("must be 1-64 chars of [a-z0-9-]"), "{err}");
    }

    #[test]
    fn validate_folder_accepts_a_well_formed_manifest() {
        let d = ScratchDir::new("good");
        std::fs::write(d.0.join("view.json"), "{}").unwrap();
        let v = json!({"id": "mine", "name": "N", "version": "1.0.0", "api": 1});
        assert_eq!(validate_folder(&v, "mine", &d.0), None);
    }

    #[test]
    fn folder_entry_reports_marketplace_source_and_no_error_for_a_valid_installed_folder() {
        let d = ScratchDir::new("full-good");
        std::fs::write(d.0.join("view.json"), "{}").unwrap();
        std::fs::write(
            d.0.join("manifest.json"),
            json!({"id": "mine", "name": "Mine", "version": "1.0.0", "api": 1}).to_string(),
        )
        .unwrap();
        std::fs::write(
            d.0.join("installed.json"),
            json!({"id": "mine", "version": "1.0.0", "kind": "tile", "installed_at": 1}).to_string(),
        )
        .unwrap();
        let entry = folder_entry(&d.0, "mine".to_string());
        assert_eq!(entry.source, "marketplace");
        assert_eq!(entry.manifest_error, None);
    }

    #[test]
    fn folder_entry_reports_local_source_without_a_marker() {
        let d = ScratchDir::new("no-marker-entry");
        std::fs::write(d.0.join("view.json"), "{}").unwrap();
        std::fs::write(
            d.0.join("manifest.json"),
            json!({"id": "mine", "name": "Mine", "version": "1.0.0", "api": 1}).to_string(),
        )
        .unwrap();
        let entry = folder_entry(&d.0, "mine".to_string());
        assert_eq!(entry.source, "local");
        assert_eq!(entry.manifest_error, None);
    }

    #[test]
    fn folder_entry_reports_local_source_on_a_corrupt_marker() {
        let d = ScratchDir::new("corrupt-marker-entry");
        std::fs::write(d.0.join("view.json"), "{}").unwrap();
        std::fs::write(
            d.0.join("manifest.json"),
            json!({"id": "mine", "name": "Mine", "version": "1.0.0", "api": 1}).to_string(),
        )
        .unwrap();
        std::fs::write(d.0.join("installed.json"), "not json").unwrap();
        let entry = folder_entry(&d.0, "mine".to_string());
        assert_eq!(entry.source, "local");
        assert_eq!(entry.manifest_error, None);
    }
}
