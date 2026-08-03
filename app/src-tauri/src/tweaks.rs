//! Durable tweaks store. Frontend `useTweaks` reads/writes a single JSON blob
//! kept at `<app_data_dir>/tweaks.json`. Writes are atomic: temp file + rename.

use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_dialog::DialogExt;

fn tweaks_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
    Ok(dir.join("tweaks.json"))
}

#[tauri::command]
pub fn tweaks_load<R: Runtime>(app: AppHandle<R>) -> Result<Option<Value>, String> {
    let path = tweaks_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
    if bytes.is_empty() {
        return Ok(None);
    }
    let value: Value = serde_json::from_slice(&bytes)
        .map_err(|e| format!("parse {}: {e}", path.display()))?;
    Ok(Some(value))
}

#[tauri::command]
pub fn tweaks_save<R: Runtime>(app: AppHandle<R>, value: Value) -> Result<(), String> {
    let path = tweaks_path(&app)?;
    let tmp = path.with_extension("json.tmp");
    let mut f = fs::File::create(&tmp).map_err(|e| format!("create {}: {e}", tmp.display()))?;
    f.write_all(serde_json::to_string_pretty(&value).unwrap().as_bytes())
        .map_err(|e| format!("write {}: {e}", tmp.display()))?;
    f.sync_all().map_err(|e| format!("sync {}: {e}", tmp.display()))?;
    drop(f);
    fs::rename(&tmp, &path).map_err(|e| format!("rename to {}: {e}", path.display()))?;
    Ok(())
}

/// Save-dialog + write. `json` is a frontend-provided JSON string,
/// pretty-printed here so hand-editing the exported file is pleasant.
/// `file_name` overrides the dialog's default name — settings export omits
/// it (keeps "2ndmonitor-settings.json"); profile export (0.7.1 §3) passes
/// "<profile>.2ndmonitor-profile.json".
#[tauri::command]
pub async fn tweaks_export<R: Runtime>(
    app: AppHandle<R>,
    json: String,
    file_name: Option<String>,
) -> Result<bool, String> {
    let value: Value = serde_json::from_str(&json).map_err(|e| format!("bad json: {e}"))?;
    let Some(path) = app
        .dialog()
        .file()
        .set_file_name(file_name.as_deref().unwrap_or("2ndmonitor-settings.json"))
        .add_filter("JSON", &["json"])
        .blocking_save_file()
        .and_then(|p| p.into_path().ok())
    else {
        return Ok(false);
    };
    fs::write(&path, serde_json::to_string_pretty(&value).unwrap())
        .map_err(|e| format!("write {}: {e}", path.display()))?;
    Ok(true)
}

/// Shows a blocking native error dialog. Used so a bad import file is never a
/// silent no-op — the user sees exactly why nothing changed.
fn show_import_error<R: Runtime>(app: &AppHandle<R>, message: String) {
    app.dialog()
        .message(message)
        .title("Import failed")
        .kind(tauri_plugin_dialog::MessageDialogKind::Error)
        .blocking_show();
}

#[tauri::command]
pub async fn tweaks_import<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, String> {
    let Some(path) = app
        .dialog()
        .file()
        .add_filter("JSON", &["json"])
        .blocking_pick_file()
        .and_then(|p| p.into_path().ok())
    else {
        return Ok(None);
    };
    let text = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(e) => {
            show_import_error(&app, format!("Could not read {}:\n{e}", path.display()));
            return Ok(None);
        }
    };
    // Parse to validate early — a clear error beats a silent no-op merge.
    let value: Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(e) => {
            show_import_error(&app, format!("{} is not valid JSON:\n{e}", path.display()));
            return Ok(None);
        }
    };
    // Arrays/primitives would otherwise reach the frontend's mergeTweaks and
    // (via object-spread of a non-object) silently corrupt state — reject here
    // with a visible dialog instead of relying solely on the frontend guard.
    if !value.is_object() {
        show_import_error(
            &app,
            format!("{} does not contain a settings object.", path.display()),
        );
        return Ok(None);
    }
    Ok(Some(text))
}
