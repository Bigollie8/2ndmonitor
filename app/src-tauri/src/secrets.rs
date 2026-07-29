//! DPAPI-encrypted key-value secret store.
//!
//! Secrets (API tokens like "github_pat", "ha_token") live in
//! `<app_config_dir>/secrets.json` as `{ key: base64(dpapi_blob) }`. DPAPI
//! current-user scope means the blobs only decrypt on this machine for this
//! Windows account — no key management on our side, and the file is useless
//! if copied elsewhere. Writes are atomic (temp + rename), same as tweaks.rs.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{Map, Value};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};

fn secrets_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("app_config_dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
    Ok(dir.join("secrets.json"))
}

fn load_map<R: Runtime>(app: &AppHandle<R>) -> Result<Map<String, Value>, String> {
    let path = secrets_path(app)?;
    if !path.exists() {
        return Ok(Map::new());
    }
    let bytes = fs::read(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
    if bytes.is_empty() {
        return Ok(Map::new());
    }
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|e| format!("parse {}: {e}", path.display()))?;
    match value {
        Value::Object(map) => Ok(map),
        _ => Err(format!("{}: expected a JSON object", path.display())),
    }
}

/// Atomic write: temp file + rename, so a crash mid-write can never leave a
/// truncated secrets file behind (pattern copied from tweaks.rs).
fn save_map<R: Runtime>(app: &AppHandle<R>, map: &Map<String, Value>) -> Result<(), String> {
    let path = secrets_path(app)?;
    let tmp = path.with_extension("json.tmp");
    let body = serde_json::to_string_pretty(&Value::Object(map.clone()))
        .map_err(|e| format!("serialize secrets: {e}"))?;
    let mut f = fs::File::create(&tmp).map_err(|e| format!("create {}: {e}", tmp.display()))?;
    f.write_all(body.as_bytes())
        .map_err(|e| format!("write {}: {e}", tmp.display()))?;
    f.sync_all().map_err(|e| format!("sync {}: {e}", tmp.display()))?;
    drop(f);
    fs::rename(&tmp, &path).map_err(|e| format!("rename to {}: {e}", path.display()))?;
    Ok(())
}

#[tauri::command]
pub fn secret_get<R: Runtime>(app: AppHandle<R>, key: String) -> Option<String> {
    // Missing file, missing key, or a blob that no longer decrypts (file
    // copied from another machine / user profile) all read as "no secret" —
    // the frontend treats None as "not configured".
    let map = load_map(&app).ok()?;
    let b64 = map.get(&key)?.as_str()?;
    let cipher = STANDARD.decode(b64).ok()?;
    let plain = dpapi::unprotect(&cipher).ok()?;
    String::from_utf8(plain).ok()
}

#[tauri::command]
pub fn secret_set<R: Runtime>(app: AppHandle<R>, key: String, value: String) -> Result<(), String> {
    let cipher = dpapi::protect(value.as_bytes())?;
    let mut map = load_map(&app)?;
    map.insert(key, Value::String(STANDARD.encode(cipher)));
    save_map(&app, &map)
}

#[tauri::command]
pub fn secret_delete<R: Runtime>(app: AppHandle<R>, key: String) -> Result<(), String> {
    let mut map = load_map(&app)?;
    if map.remove(&key).is_some() {
        save_map(&app, &map)?;
    }
    Ok(())
}

#[cfg(windows)]
mod dpapi {
    //! CryptProtectData / CryptUnprotectData, current-user scope. The output
    //! blob is self-describing (embeds the master-key reference + salt), so we
    //! store it verbatim and hand it straight back for decryption.

    use windows::core::PWSTR;
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    /// Copy a DPAPI output blob into owned memory, then free the LocalAlloc'd
    /// buffer the API handed us — the caller owns that allocation.
    unsafe fn take_blob(blob: CRYPT_INTEGER_BLOB) -> Vec<u8> {
        if blob.pbData.is_null() {
            return Vec::new();
        }
        let out = std::slice::from_raw_parts(blob.pbData, blob.cbData as usize).to_vec();
        let _ = LocalFree(HLOCAL(blob.pbData as *mut core::ffi::c_void));
        out
    }

    pub fn protect(plain: &[u8]) -> Result<Vec<u8>, String> {
        let input = CRYPT_INTEGER_BLOB {
            cbData: plain.len() as u32,
            pbData: plain.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB::default();
        unsafe {
            // UI_FORBIDDEN: never pop a credential prompt from a background
            // command — fail instead.
            CryptProtectData(
                &input,
                PWSTR::null(),
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
            .map_err(|e| format!("CryptProtectData: {e}"))?;
            Ok(take_blob(output))
        }
    }

    pub fn unprotect(cipher: &[u8]) -> Result<Vec<u8>, String> {
        let input = CRYPT_INTEGER_BLOB {
            cbData: cipher.len() as u32,
            pbData: cipher.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB::default();
        unsafe {
            CryptUnprotectData(
                &input,
                None,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
            .map_err(|e| format!("CryptUnprotectData: {e}"))?;
            Ok(take_blob(output))
        }
    }
}

#[cfg(not(windows))]
mod dpapi {
    // Non-Windows builds keep the module compiling; the store is Windows-only.
    pub fn protect(_plain: &[u8]) -> Result<Vec<u8>, String> {
        Err("DPAPI secret store is Windows-only".into())
    }
    pub fn unprotect(_cipher: &[u8]) -> Result<Vec<u8>, String> {
        Err("DPAPI secret store is Windows-only".into())
    }
}
