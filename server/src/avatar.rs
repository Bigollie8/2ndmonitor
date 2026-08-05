//! Profile pictures.
//!
//! Sniffed, never trusted: the stored bytes must begin with a PNG or JPEG
//! magic number, exactly like `submit::validate_preview`. There is no
//! content-type header here — just base64 in a JSON field — so a caller's
//! say-so about the format means nothing.
//!
//! Served from the database rather than a directory, for the same reason
//! bundle previews are: one file to back up, no filesystem paths derived
//! from user input, and nothing to serve if the row is gone.
use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::Response;
use axum::Json;
use base64::Engine;
use serde_json::{json, Value};

use crate::auth::bearer_user;
use crate::AppState;

/// 512 KB. Generous for an avatar, small enough that a row stays cheap to
/// read and the whole table stays cheap to back up.
pub const AVATAR_CAP: usize = 512 * 1024;

/// PNG or JPEG on the magic number alone. Same rule, same reasoning, as
/// `submit::sniff_image` — kept here rather than shared so a change to
/// bundle-preview policy cannot silently change avatar policy.
pub fn sniff(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() >= 8 && bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Some("image/png");
    }
    if bytes.len() >= 3 && bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("image/jpeg");
    }
    None
}

pub fn validate(bytes: &[u8]) -> Result<&'static str, String> {
    if bytes.is_empty() {
        return Err("avatar is empty".into());
    }
    if bytes.len() > AVATAR_CAP {
        return Err(format!("avatar too large ({} > {AVATAR_CAP} bytes)", bytes.len()));
    }
    sniff(bytes).ok_or_else(|| "avatar must be a PNG or JPEG".to_string())
}

/// Upload or clear your own picture. An empty body clears it, which is how
/// someone goes back to their generated identicon.
pub async fn put_avatar(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let user = bearer_user(&state, &headers).map_err(|s| (s, "sign in first".to_string()))?;
    let encoded = body.get("image").and_then(Value::as_str).unwrap_or("");

    if encoded.trim().is_empty() {
        let db = state.db.lock();
        db.execute("UPDATE users SET avatar = NULL WHERE id = ?1", [user])
            .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "write failed".to_string()))?;
        return Ok(Json(json!({ "ok": true, "hasAvatar": false })));
    }

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("avatar is not valid base64: {e}")))?;
    validate(&bytes).map_err(|e| (StatusCode::BAD_REQUEST, e))?;

    let db = state.db.lock();
    db.execute("UPDATE users SET avatar = ?1 WHERE id = ?2", rusqlite::params![bytes, user])
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "write failed".to_string()))?;
    Ok(Json(json!({ "ok": true, "hasAvatar": true })))
}

/// A creator's picture, by handle. Public — it appears next to their name
/// everywhere — and 404s when they have none so the client falls back to the
/// generated identicon rather than rendering a broken image.
///
/// A suspended creator's avatar stops being served: hiding them is the point
/// of a suspension, and a face is the most visible thing they have.
pub async fn get_avatar(
    State(state): State<AppState>,
    Path(handle): Path<String>,
) -> Result<Response, StatusCode> {
    let handle = crate::handle::normalise(&handle);
    let db = state.db.lock();
    let bytes: Vec<u8> = db
        .query_row(
            "SELECT avatar FROM users WHERE handle = ?1 AND suspended = 0 AND avatar IS NOT NULL",
            [&handle],
            |r| r.get(0),
        )
        .map_err(|_| StatusCode::NOT_FOUND)?;

    let mime = sniff(&bytes).ok_or(StatusCode::NOT_FOUND)?;
    Response::builder()
        .header(header::CONTENT_TYPE, mime)
        // Short cache: long enough that a page of avatars is one fetch each,
        // short enough that changing your picture shows up promptly.
        .header(header::CACHE_CONTROL, "public, max-age=300")
        .body(Body::from(bytes))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}
