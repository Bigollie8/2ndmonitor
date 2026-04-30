//! Durable tweaks store. Frontend `useTweaks` reads/writes a single JSON blob
//! kept at `<app_data_dir>/tweaks.json`. Writes are atomic: temp file + rename.

use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};

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
