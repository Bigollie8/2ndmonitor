//! DPAPI-encrypted key-value secret store.
//!
//! Secrets (API tokens like "github_pat", "ha_token") live in
//! `<app_config_dir>/secrets.json` as `{ key: base64(dpapi_blob) }`. DPAPI
//! current-user scope means the blobs only decrypt on this machine for this
//! Windows account — no key management on our side, and the file is useless
//! if copied elsewhere. Writes are atomic (temp + rename), same as tweaks.rs.
//!
//! # Reserved keys
//!
//! `secret_get`/`secret_set`/`secret_delete` are `#[tauri::command]`s
//! reachable from the main webview (see permissions/app-commands.toml) — that
//! is deliberate, it's how the credential-connect panels in Settings work for
//! github_pat/ha_token/Spotify creds/per-bundle secrets. But a generic
//! "any key, any value" surface is wrong for a value the frontend has NO
//! legitimate reason to read or write at all. `marketplace_session`
//! (marketplace.rs) is the first such key: before `RESERVED_KEYS` existed,
//! `invoke('secret_get', { key: 'marketplace_session' })` from the main
//! webview returned the DPAPI-decrypted session token in plain text, which
//! directly contradicted marketplace.rs's documented "never returned to the
//! frontend" contract for it — see the CORRECTION note at the top of the
//! sign-in section of marketplace.rs for the full account of that gap.
//!
//! `RESERVED_KEYS` closes it: the three command wrappers below reject a
//! reserved key outright, before the store is touched at all — pinned by
//! `secret_get_set_delete_commands_check_is_reserved_before_calling_the_inner_store_fn`
//! below, which reads this file's own source to prove the guard runs before
//! the inner store call, not just that `is_reserved` itself is correct.
//! `secret_get`/`secret_set`/`secret_delete` returning `None`/`Err` for a
//! reserved key is not a "not found" lie for `secret_get` specifically — it
//! is indistinguishable from "not found" on purpose, so a probe for a
//! reserved key learns nothing beyond "you don't get this one".
//!
//! Rust callers that DO have a legitimate reason to touch a reserved key
//! (marketplace.rs's own login/logout/status) go around the guard entirely
//! via `secret_get_inner`/`secret_set_inner`/`secret_delete_inner`: plain
//! functions, not `#[tauri::command]`s, and therefore not reachable over IPC
//! under any key, reserved or not.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{Map, Value};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};

/// Keys a `#[tauri::command]` caller (i.e. the frontend) may never read,
/// write, or delete through the generic secret commands — see the module doc
/// above. Add a key here, not a case in the commands below, so
/// `is_reserved`'s own test and the source-pin test both cover it uniformly.
const RESERVED_KEYS: &[&str] = &["marketplace_session"];

fn is_reserved(key: &str) -> bool {
    RESERVED_KEYS.contains(&key)
}

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

// ---------------------------------------------------------------------------
// Inner store access — plain Rust functions, NOT `#[tauri::command]`s, so
// they are not reachable over IPC under any key. This is what a Rust caller
// (marketplace.rs) uses to touch a reserved key; the guarded commands below
// call these too, for every key that isn't reserved.
// ---------------------------------------------------------------------------

pub fn secret_get_inner<R: Runtime>(app: &AppHandle<R>, key: &str) -> Option<String> {
    // Missing file, missing key, or a blob that no longer decrypts (file
    // copied from another machine / user profile) all read as "no secret" —
    // callers treat None as "not configured".
    let map = load_map(app).ok()?;
    let b64 = map.get(key)?.as_str()?;
    let cipher = STANDARD.decode(b64).ok()?;
    let plain = dpapi::unprotect(&cipher).ok()?;
    String::from_utf8(plain).ok()
}

pub fn secret_set_inner<R: Runtime>(app: &AppHandle<R>, key: &str, value: &str) -> Result<(), String> {
    let cipher = dpapi::protect(value.as_bytes())?;
    let mut map = load_map(app)?;
    map.insert(key.to_string(), Value::String(STANDARD.encode(cipher)));
    save_map(app, &map)
}

pub fn secret_delete_inner<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<(), String> {
    let mut map = load_map(app)?;
    if map.remove(key).is_some() {
        save_map(app, &map)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// IPC-facing commands — reject a reserved key before the store is ever
// touched, then delegate to the inner functions above for everything else.
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn secret_get<R: Runtime>(app: AppHandle<R>, key: String) -> Option<String> {
    if is_reserved(&key) {
        return None;
    }
    secret_get_inner(&app, &key)
}

#[tauri::command]
pub fn secret_set<R: Runtime>(app: AppHandle<R>, key: String, value: String) -> Result<(), String> {
    if is_reserved(&key) {
        return Err(format!("{key:?} is a reserved key and cannot be set through this command"));
    }
    secret_set_inner(&app, &key, &value)
}

#[tauri::command]
pub fn secret_delete<R: Runtime>(app: AppHandle<R>, key: String) -> Result<(), String> {
    if is_reserved(&key) {
        return Err(format!("{key:?} is a reserved key and cannot be deleted through this command"));
    }
    secret_delete_inner(&app, &key)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_reserved_blocks_the_marketplace_session_key_and_nothing_else() {
        assert!(is_reserved("marketplace_session"));
        assert!(!is_reserved("github_pat"));
        assert!(!is_reserved("ha_token"));
        assert!(!is_reserved("bundle.some-id.api_key"));
        assert!(!is_reserved(""));
        assert!(!is_reserved("marketplace_session_status")); // must be exact, not a prefix match
    }

    /// Guards against someone deleting the `is_reserved` guard from a command
    /// wrapper's body while leaving `is_reserved` itself (and the test above)
    /// intact and green — exactly the kind of regression a pure-predicate
    /// test alone cannot catch, since the predicate would still report
    /// correctly even if nothing in `secret_get`/`secret_set`/`secret_delete`
    /// ever called it. There is no runtime way to ask "does this command's
    /// body check the guard before touching the store" — reading the source
    /// is what lib.rs's own `acl_tests` do for the equivalent reason.
    #[test]
    fn secret_get_set_delete_commands_check_is_reserved_before_calling_the_inner_store_fn() {
        let src = include_str!("secrets.rs");
        for (sig, inner_call) in [
            (
                "pub fn secret_get<R: Runtime>(app: AppHandle<R>, key: String) -> Option<String> {",
                "secret_get_inner(",
            ),
            (
                "pub fn secret_set<R: Runtime>(app: AppHandle<R>, key: String, value: String) -> Result<(), String> {",
                "secret_set_inner(",
            ),
            (
                "pub fn secret_delete<R: Runtime>(app: AppHandle<R>, key: String) -> Result<(), String> {",
                "secret_delete_inner(",
            ),
        ] {
            let start = src
                .find(sig)
                .unwrap_or_else(|| panic!("signature not found (did it change?): {sig}"));
            let body = &src[start..];
            let guard_at = body
                .find("is_reserved(&key)")
                .unwrap_or_else(|| panic!("no is_reserved(&key) guard found in: {sig}"));
            let inner_at = body
                .find(inner_call)
                .unwrap_or_else(|| panic!("no call to {inner_call} found in: {sig}"));
            assert!(
                guard_at < inner_at,
                "{sig}: the is_reserved guard must run BEFORE the store is ever touched"
            );
        }
    }
}
