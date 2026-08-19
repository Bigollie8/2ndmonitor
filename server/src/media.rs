//! Bundle media: ordered preview assets per (bundle id, version).
//!
//! Distinct from the legacy `bundles.preview` blob, which stores exactly one
//! still and is what every bundle published before Market v2 carries. Both are
//! live: `/preview` prefers media index 0 and falls back to the blob, so a
//! 0.7.x client keeps getting the bytes it has always got.
//!
//! Media is served per-asset and never enters the signed index — only the count
//! does. Bytes live on the row, never in the zip: the zip's payload set is
//! fixed and installer-trusted (see submit.rs).

use crate::state::AppState;
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use base64::Engine;
use serde_json::{json, Value};

const MAX_ASSETS: i64 = 6;
const MAX_STILL: usize = 256 * 1024;
const MAX_ANIM: usize = 2 * 1024 * 1024;

/// Magic-byte sniff, mirroring `submit::sniff_image` but extended with WebP
/// (RIFF....WEBP), which animated media needs and the still-only preview path
/// never had a reason to accept.
fn sniff(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some("image/png")
    } else if bytes.starts_with(b"GIF8") {
        Some("image/gif")
    } else if bytes.len() > 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

pub async fn get_media(
    State(state): State<AppState>,
    Path((id, version, idx)): Path<(String, String, i64)>,
) -> Result<Response, StatusCode> {
    let db = state.db.lock();
    let (mime, bytes): (String, Vec<u8>) = db
        .query_row(
            "SELECT m.mime, m.bytes FROM bundle_media m
             JOIN bundles b ON b.id = m.bundle_id AND b.version = m.version
             WHERE m.bundle_id = ?1 AND m.version = ?2 AND m.idx = ?3 AND b.status = 'approved'",
            rusqlite::params![id, version, idx],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| StatusCode::NOT_FOUND)?;
    Ok((
        [
            (header::CONTENT_TYPE, mime),
            // Public read surface — same open CORS as index.rs, same reason.
            (header::ACCESS_CONTROL_ALLOW_ORIGIN, "*".to_string()),
        ],
        bytes,
    )
        .into_response())
}

pub async fn put_media(
    State(state): State<AppState>,
    Path((id, version)): Path<(String, String)>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, String)> {
    crate::admin::require_admin_pub(&state, &headers)
        .map_err(|s| (s, "admin token required".to_string()))?;

    let idx = body
        .get("idx")
        .and_then(Value::as_i64)
        .ok_or((StatusCode::BAD_REQUEST, "idx is required".to_string()))?;
    let kind = body
        .get("kind")
        .and_then(Value::as_str)
        .ok_or((StatusCode::BAD_REQUEST, "kind is required".to_string()))?;
    if kind != "still" && kind != "anim" {
        return Err((StatusCode::BAD_REQUEST, "kind must be \"still\" or \"anim\"".into()));
    }
    let b64 = body
        .get("bytes")
        .and_then(Value::as_str)
        .ok_or((StatusCode::BAD_REQUEST, "bytes is required".to_string()))?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("bytes is not valid base64: {e}")))?;

    let cap = if kind == "anim" { MAX_ANIM } else { MAX_STILL };
    if bytes.len() > cap {
        return Err((StatusCode::BAD_REQUEST, format!("{kind} must be at most {cap} bytes")));
    }
    let mime = sniff(&bytes)
        .ok_or((StatusCode::BAD_REQUEST, "bytes must be a PNG, GIF or WebP image".to_string()))?;

    let db = state.db.lock();
    let exists: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM bundles WHERE id = ?1 AND version = ?2)",
            rusqlite::params![id, version],
            |r| r.get(0),
        )
        .unwrap_or(false);
    if !exists {
        return Err((StatusCode::NOT_FOUND, "no such bundle version".into()));
    }

    // Count only OTHER indexes: re-uploading an existing slot replaces it and
    // must not be refused once the cap is reached.
    let others: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM bundle_media WHERE bundle_id = ?1 AND version = ?2 AND idx != ?3",
            rusqlite::params![id, version, idx],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if others >= MAX_ASSETS {
        return Err((StatusCode::BAD_REQUEST, format!("at most {MAX_ASSETS} assets per version")));
    }

    db.execute(
        "INSERT OR REPLACE INTO bundle_media (bundle_id, version, idx, kind, mime, bytes)
         VALUES (?1,?2,?3,?4,?5,?6)",
        rusqlite::params![id, version, idx, kind, mime, bytes],
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(json!({ "ok": true, "mime": mime })))
}

pub async fn delete_media(
    State(state): State<AppState>,
    Path((id, version, idx)): Path<(String, String, i64)>,
    headers: HeaderMap,
) -> Result<Json<Value>, StatusCode> {
    crate::admin::require_admin_pub(&state, &headers)?;
    let db = state.db.lock();
    db.execute(
        "DELETE FROM bundle_media WHERE bundle_id = ?1 AND version = ?2 AND idx = ?3",
        rusqlite::params![id, version, idx],
    )
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(json!({ "ok": true })))
}
