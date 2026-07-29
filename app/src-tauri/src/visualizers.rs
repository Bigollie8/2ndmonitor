//! Scripted-visualizer store: `<app_data_dir>/visualizers/<id>/` folders each
//! holding `manifest.json` + `main.js`. The frontend runs them in a sandboxed
//! iframe (see src/sandbox/). A std-only polling watcher (2s) emits
//! `visualizers:changed` whenever anything under the dir changes, driving
//! hot reload — polling avoids a native watcher dependency and 2s latency is
//! fine for a save-and-glance workflow.

use serde::Serialize;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter, Manager, Runtime};

#[derive(Debug, Clone, Serialize)]
pub struct VizFolder {
    pub id: String,
    pub name: String,
    pub author: Option<String>,
    pub version: String,
    pub api: Option<u64>,
    /// Set when manifest.json is missing/unparsable — listed so the UI can
    /// show the folder with an explanatory badge instead of hiding it.
    pub manifest_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VizSource {
    pub manifest: String,
    pub code: String,
}

fn visualizers_dir<R: Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?
        .join("visualizers");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create visualizers dir: {e}"))?;
    Ok(dir)
}

/// Folder ids are also used in paths; same shape the frontend manifest
/// validator enforces (`[a-z0-9-]{1,64}`).
fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn folder_entry(path: &std::path::Path, id: String) -> VizFolder {
    let manifest_path = path.join("manifest.json");
    let text = match std::fs::read_to_string(&manifest_path) {
        Ok(t) => t,
        Err(e) => {
            return VizFolder {
                id: id.clone(),
                name: id,
                author: None,
                version: String::new(),
                api: None,
                manifest_error: Some(format!("manifest.json unreadable: {e}")),
            }
        }
    };
    match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(v) => VizFolder {
            name: v
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or(&id)
                .to_string(),
            author: v.get("author").and_then(|a| a.as_str()).map(String::from),
            version: v
                .get("version")
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .to_string(),
            api: v.get("api").and_then(|a| a.as_u64()),
            manifest_error: None,
            id,
        },
        Err(e) => VizFolder {
            id: id.clone(),
            name: id,
            author: None,
            version: String::new(),
            api: None,
            manifest_error: Some(format!("manifest.json invalid: {e}")),
        },
    }
}

#[tauri::command]
pub fn visualizers_list<R: Runtime>(app: AppHandle<R>) -> Result<Vec<VizFolder>, String> {
    let dir = visualizers_dir(&app)?;
    let mut out = Vec::new();
    let entries = std::fs::read_dir(&dir).map_err(|e| format!("read visualizers dir: {e}"))?;
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
pub fn visualizers_read<R: Runtime>(app: AppHandle<R>, id: String) -> Result<VizSource, String> {
    if !is_safe_id(&id) {
        return Err("invalid visualizer id".into());
    }
    let dir = visualizers_dir(&app)?.join(&id);
    let manifest = std::fs::read_to_string(dir.join("manifest.json"))
        .map_err(|e| format!("read manifest: {e}"))?;
    let code =
        std::fs::read_to_string(dir.join("main.js")).map_err(|e| format!("read main.js: {e}"))?;
    Ok(VizSource { manifest, code })
}

#[tauri::command]
pub fn visualizers_write<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    manifest: Option<String>,
    code: Option<String>,
) -> Result<(), String> {
    if !is_safe_id(&id) {
        return Err("invalid visualizer id".into());
    }
    let dir = visualizers_dir(&app)?.join(&id);
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {id}: {e}"))?;
    // Atomic-ish: temp + rename, matching tweaks.rs.
    let write = |name: &str, contents: &str| -> Result<(), String> {
        let tmp = dir.join(format!("{name}.tmp"));
        let dst = dir.join(name);
        std::fs::write(&tmp, contents).map_err(|e| format!("write {name}: {e}"))?;
        std::fs::rename(&tmp, &dst).map_err(|e| format!("rename {name}: {e}"))
    };
    if let Some(m) = manifest {
        write("manifest.json", &m)?;
    }
    if let Some(c) = code {
        write("main.js", &c)?;
    }
    Ok(())
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
        let Ok(dir) = visualizers_dir(&app) else {
            eprintln!("visualizers watcher disabled: no app data dir");
            return;
        };
        let mut last = fingerprint(&dir);
        loop {
            std::thread::sleep(Duration::from_secs(2));
            let now = fingerprint(&dir);
            if now != last {
                last = now;
                let _ = app.emit("visualizers:changed", ());
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::is_safe_id;

    #[test]
    fn accepts_normal_ids() {
        assert!(is_safe_id("my-viz1"));
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
}
