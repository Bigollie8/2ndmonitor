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

fn presets_dir<R: Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?
        .join("presets");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create presets dir: {e}"))?;
    Ok(dir)
}

/// Reject anything that could escape the presets dir. Filenames only.
fn is_safe_name(name: &str) -> bool {
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

#[cfg(test)]
mod tests {
    use super::is_safe_name;

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
}
