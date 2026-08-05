//! Creator accounts: reading your own profile, editing it, and claiming a
//! handle.
//!
//! `display_name` has existed since the first schema and until now had no
//! writer at all — which is why author pages read `oli***`. Requiring a handle
//! before publishing (see submit.rs) is what makes it get filled in.
//!
//! Email addresses never leave this module unmasked. `GET /account` returns
//! the same `abc***` shape `index.rs` uses for bundle authors, so there is no
//! endpoint anywhere that can serialize a raw address.

use crate::auth::bearer_user;
use crate::handle::validate as validate_handle;
use crate::state::AppState;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde_json::{json, Value};

const MAX_BIO: usize = 280;
const MAX_LINKS: usize = 3;
const MAX_DISPLAY_NAME: usize = 40;

fn masked(email: &str) -> String {
    format!("{}***", email.chars().take(3).collect::<String>())
}

/// Your own account. Authenticated: this is the only place bio/links come
/// back alongside the (masked) address, and it is never used to render
/// someone else's profile — see Phase 3's public creator endpoint for that.
pub async fn get_account(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, StatusCode> {
    let user_id = bearer_user(&state, &headers)?;
    let db = state.db.lock();
    let (email, handle, display_name, bio, links, avatar_seed, suspended): (
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        String,
        Option<String>,
        i64,
    ) = db
        .query_row(
            "SELECT email, handle, display_name, bio, links, avatar_seed, suspended
             FROM users WHERE id = ?1",
            [user_id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                ))
            },
        )
        .map_err(|_| StatusCode::NOT_FOUND)?;

    Ok(Json(json!({
        "email": masked(&email),
        "handle": handle,
        "displayName": display_name,
        "bio": bio,
        "links": serde_json::from_str::<Value>(&links).unwrap_or(json!([])),
        "avatarSeed": avatar_seed,
        "suspended": suspended != 0,
    })))
}

/// Claim a handle. One-time: changing it afterwards is an admin action, so a
/// creator cannot shed a reputation by renaming, and links to their work do
/// not rot.
pub async fn claim_handle(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let user_id = bearer_user(&state, &headers).map_err(|s| (s, "auth required".to_string()))?;
    let raw = body.get("handle").and_then(Value::as_str).unwrap_or("");
    let handle = validate_handle(raw).map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;

    let db = state.db.lock();
    let existing: Option<String> = db
        .query_row("SELECT handle FROM users WHERE id = ?1", [user_id], |r| r.get(0))
        .map_err(|_| (StatusCode::NOT_FOUND, "no such account".to_string()))?;
    if existing.is_some() {
        return Err((
            StatusCode::FORBIDDEN,
            "your handle is already set; ask an admin to change it".to_string(),
        ));
    }

    // The unique index is what actually decides this. Checking first and then
    // inserting would race: two claims for the same handle could both pass the
    // check. So attempt the write and read the error.
    match db.execute(
        "UPDATE users SET handle = ?1, avatar_seed = COALESCE(avatar_seed, ?1) WHERE id = ?2",
        rusqlite::params![handle, user_id],
    ) {
        Ok(_) => Ok(Json(json!({ "ok": true, "handle": handle }))),
        Err(_) => Err((StatusCode::CONFLICT, "that handle is taken".to_string())),
    }
}

/// Edit the parts of a profile that are free text.
pub async fn patch_account(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let user_id = bearer_user(&state, &headers).map_err(|s| (s, "auth required".to_string()))?;
    let db = state.db.lock();

    if let Some(v) = body.get("displayName") {
        let name = v.as_str().unwrap_or("").trim().to_string();
        if name.is_empty() {
            return Err((StatusCode::BAD_REQUEST, "display name must not be blank".into()));
        }
        if name.chars().count() > MAX_DISPLAY_NAME {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("display name must be at most {MAX_DISPLAY_NAME} characters"),
            ));
        }
        db.execute("UPDATE users SET display_name = ?1 WHERE id = ?2", rusqlite::params![name, user_id])
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    if let Some(v) = body.get("bio") {
        let bio = v.as_str().unwrap_or("").trim().to_string();
        if bio.chars().count() > MAX_BIO {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("bio must be at most {MAX_BIO} characters"),
            ));
        }
        db.execute("UPDATE users SET bio = ?1 WHERE id = ?2", rusqlite::params![bio, user_id])
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    if let Some(v) = body.get("links") {
        let arr = v
            .as_array()
            .ok_or((StatusCode::BAD_REQUEST, "links must be an array".to_string()))?;
        if arr.len() > MAX_LINKS {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("at most {MAX_LINKS} links"),
            ));
        }
        for l in arr {
            let s = l
                .as_str()
                .ok_or((StatusCode::BAD_REQUEST, "each link must be a string".to_string()))?;
            // https only. A creator profile is rendered in the app, and an
            // http link there is both a downgrade and a mixed-content problem.
            let parsed = url::Url::parse(s)
                .map_err(|_| (StatusCode::BAD_REQUEST, format!("{s} is not a URL")))?;
            if parsed.scheme() != "https" {
                return Err((StatusCode::BAD_REQUEST, format!("{s} must be https")));
            }
            if s.chars().count() > 200 {
                return Err((StatusCode::BAD_REQUEST, "links must be at most 200 characters".into()));
            }
        }
        let encoded = serde_json::to_string(arr).unwrap_or_else(|_| "[]".into());
        db.execute("UPDATE users SET links = ?1 WHERE id = ?2", rusqlite::params![encoded, user_id])
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    Ok(Json(json!({ "ok": true })))
}
