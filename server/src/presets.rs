//! Cloud backup for a user's visualizer presets (0.9.15).
//!
//! One store per account: the flat `.json`/`.milk` files from the app's
//! `<app_data>/presets/` dir, keyed by filename. Stored in the database, not
//! a directory — same reasoning as avatars: one file to back up, and no
//! filesystem paths derived from user input.
//!
//! Addressing is POST-body (`{ "file": ... }`), not path params: preset
//! filenames carry spaces and parentheses, and the rest of this API is
//! POST-shaped (`/notifications/read`, `/admin/decide`).
//!
//! The filename rule mirrors the app's `presets.rs::is_safe_name` — the
//! server does not trust the client either — plus an extension whitelist and
//! a length cap. See docs/CLOUD_PRESETS.md in the app repo.
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use base64::Engine;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::auth::bearer_user;
use crate::AppState;

/// 256 KB per preset — a large Butterchurn JSON is ~50 KB.
pub const FILE_CAP: usize = 256 * 1024;
/// Per-user totals. Generous for presets, small enough that the table can
/// never become the backup problem.
pub const COUNT_CAP: i64 = 200;
pub const TOTAL_CAP: i64 = 10 * 1024 * 1024;

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// The app's `is_safe_name` rule (no separators, no `..`, no leading dot),
/// plus: bounded length and a known preset extension.
pub fn valid_file_name(name: &str) -> bool {
    let ext_ok = {
        let lower = name.to_ascii_lowercase();
        lower.ends_with(".json") || lower.ends_with(".milk")
    };
    !name.is_empty()
        && name.len() <= 120
        && !name.contains(['/', '\\'])
        && !name.contains("..")
        && !name.starts_with('.')
        && ext_ok
}

/// `GET /account/presets` — the manifest (no content). Push diffs against it.
pub async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, String)> {
    let user = bearer_user(&state, &headers).map_err(|s| (s, "sign in first".to_string()))?;
    let db = state.db.lock();
    let mut stmt = db
        .prepare("SELECT file, sha256, size, updated_at FROM user_presets WHERE user_id = ?1 ORDER BY file")
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "read failed".to_string()))?;
    let rows = stmt
        .query_map([user], |r| {
            Ok(json!({
                "file": r.get::<_, String>(0)?,
                "sha256": r.get::<_, String>(1)?,
                "size": r.get::<_, i64>(2)?,
                "updatedAt": r.get::<_, i64>(3)?,
            }))
        })
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "read failed".to_string()))?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();
    Ok(Json(json!({ "presets": rows })))
}

/// `POST /account/presets` — upsert one preset. Overwrites the cloud copy;
/// the store is "latest backup", not a history.
pub async fn put(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let user = bearer_user(&state, &headers).map_err(|s| (s, "sign in first".to_string()))?;
    let file = body.get("file").and_then(Value::as_str).unwrap_or("");
    if !valid_file_name(file) {
        return Err((StatusCode::BAD_REQUEST, "invalid preset filename".to_string()));
    }
    let encoded = body.get("content").and_then(Value::as_str).unwrap_or("");
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("content is not valid base64: {e}")))?;
    if bytes.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "preset is empty".to_string()));
    }
    if bytes.len() > FILE_CAP {
        return Err((
            StatusCode::PAYLOAD_TOO_LARGE,
            format!("preset too large ({} > {FILE_CAP} bytes)", bytes.len()),
        ));
    }

    let db = state.db.lock();
    // Quota check EXCLUDING the row this write replaces, so re-uploading an
    // existing preset never fails quota it already occupies.
    let (count, total): (i64, i64) = db
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(size), 0) FROM user_presets WHERE user_id = ?1 AND file <> ?2",
            rusqlite::params![user, file],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "read failed".to_string()))?;
    if count >= COUNT_CAP {
        return Err((
            StatusCode::PAYLOAD_TOO_LARGE,
            format!("preset limit reached ({COUNT_CAP} files)"),
        ));
    }
    if total + bytes.len() as i64 > TOTAL_CAP {
        return Err((
            StatusCode::PAYLOAD_TOO_LARGE,
            "storage limit reached (10 MB of presets)".to_string(),
        ));
    }

    let sha = hex::encode(Sha256::digest(&bytes));
    let size = bytes.len() as i64;
    db.execute(
        "INSERT INTO user_presets (user_id, file, content, sha256, size, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT (user_id, file) DO UPDATE SET
           content = excluded.content, sha256 = excluded.sha256,
           size = excluded.size, updated_at = excluded.updated_at",
        rusqlite::params![user, file, bytes, sha, size, now()],
    )
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "write failed".to_string()))?;
    Ok(Json(json!({ "ok": true, "file": file, "sha256": sha, "size": size })))
}

/// `POST /account/presets/get` — one preset's content, base64.
pub async fn get_one(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let user = bearer_user(&state, &headers).map_err(|s| (s, "sign in first".to_string()))?;
    let file = body.get("file").and_then(Value::as_str).unwrap_or("");
    if !valid_file_name(file) {
        return Err((StatusCode::BAD_REQUEST, "invalid preset filename".to_string()));
    }
    let db = state.db.lock();
    let bytes: Vec<u8> = db
        .query_row(
            "SELECT content FROM user_presets WHERE user_id = ?1 AND file = ?2",
            rusqlite::params![user, file],
            |r| r.get(0),
        )
        .map_err(|_| (StatusCode::NOT_FOUND, "no such preset".to_string()))?;
    Ok(Json(json!({
        "file": file,
        "content": base64::engine::general_purpose::STANDARD.encode(bytes),
    })))
}

/// `POST /account/presets/delete` — remove one. The quota remedy; idempotent.
pub async fn delete_one(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let user = bearer_user(&state, &headers).map_err(|s| (s, "sign in first".to_string()))?;
    let file = body.get("file").and_then(Value::as_str).unwrap_or("");
    if !valid_file_name(file) {
        return Err((StatusCode::BAD_REQUEST, "invalid preset filename".to_string()));
    }
    let db = state.db.lock();
    let n = db
        .execute(
            "DELETE FROM user_presets WHERE user_id = ?1 AND file = ?2",
            rusqlite::params![user, file],
        )
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "write failed".to_string()))?;
    Ok(Json(json!({ "ok": true, "deleted": n > 0 })))
}

#[cfg(test)]
mod tests {
    use super::valid_file_name;

    #[test]
    fn accepts_real_preset_names() {
        assert!(valid_file_name("Geiss - Reflection (remix).json"));
        assert!(valid_file_name("preset.milk"));
        assert!(valid_file_name("UPPER.JSON"));
    }

    #[test]
    fn rejects_traversal_paths_and_odd_extensions() {
        assert!(!valid_file_name("../x.json"));
        assert!(!valid_file_name("a/b.json"));
        assert!(!valid_file_name("a\\b.json"));
        assert!(!valid_file_name(".hidden.json"));
        assert!(!valid_file_name(""));
        assert!(!valid_file_name("evil.exe"));
        assert!(!valid_file_name("noext"));
        let long = format!("{}.json", "a".repeat(120));
        assert!(!valid_file_name(&long));
    }
}
