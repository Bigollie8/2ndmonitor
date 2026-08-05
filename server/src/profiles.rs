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
use axum::extract::{Path, State};
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
    let (email, handle, display_name, bio, links, avatar_seed, suspended, accent, badges, has_avatar, role): (
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        String,
        Option<String>,
        i64,
        Option<String>,
        String,
        bool,
        String,
    ) = db
        .query_row(
            "SELECT email, handle, display_name, bio, links, avatar_seed, suspended, accent, badges,
                    avatar IS NOT NULL, COALESCE(role, 'user')
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
                    r.get(7)?,
                    r.get(8)?,
                    r.get(9)?,
                    r.get(10)?,
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
        "accent": accent,
        "badges": serde_json::from_str::<Value>(&badges).unwrap_or(json!([])),
        "hasAvatar": has_avatar,
        "role": role,
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

    // A profile accent. Constrained to #rrggbb so it can only ever be a
    // colour -- no gradients, no urls, nothing that can carry a payload into
    // someone else's page.
    if let Some(v) = body.get("accent") {
        let raw = v.as_str().unwrap_or("").trim().to_lowercase();
        if raw.is_empty() {
            db.execute("UPDATE users SET accent = NULL WHERE id = ?1", rusqlite::params![user_id])
                .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "write failed".to_string()))?;
        } else {
            let ok = raw.len() == 7
                && raw.starts_with('#')
                && raw[1..].bytes().all(|b| b.is_ascii_hexdigit());
            if !ok {
                return Err((StatusCode::BAD_REQUEST, "accent must be #rrggbb".into()));
            }
            db.execute("UPDATE users SET accent = ?1 WHERE id = ?2", rusqlite::params![raw, user_id])
                .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "write failed".to_string()))?;
        }
    }

    Ok(Json(json!({ "ok": true })))
}

/// A creator's PUBLIC page: their profile plus everything they have published.
///
/// Unauthenticated and unsigned, like `/ratings` and `/reviews` — only the
/// index is signed. Callers treat a failure as "no profile", never as an
/// error worth interrupting browsing over.
///
/// A suspended creator 404s rather than rendering an empty page: hiding the
/// content is the whole point of a suspension, and a page saying "this person
/// exists but has nothing" still gives them a surface.
pub async fn get_creator(
    State(state): State<AppState>,
    Path(handle): Path<String>,
) -> Result<Json<Value>, StatusCode> {
    let handle = crate::handle::normalise(&handle);
    let db = state.db.lock();

    let (user_id, display_name, bio, links, avatar_seed, created_at, accent, badges, has_avatar): (
        i64,
        Option<String>,
        Option<String>,
        String,
        Option<String>,
        i64,
        Option<String>,
        String,
        bool,
    ) = db
        .query_row(
            "SELECT id, display_name, bio, links, avatar_seed, created_at, accent, badges,
                    avatar IS NOT NULL
             FROM users WHERE handle = ?1 AND suspended = 0",
            [&handle],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?)),
        )
        .map_err(|_| StatusCode::NOT_FOUND)?;

    // Newest version per id, approved only — the same visibility rule the
    // index applies, so a creator page can never surface something the
    // catalog would not.
    let mut stmt = db
        .prepare(
            "SELECT id, version, kind, name, summary, category, downloads, approved_at
             FROM bundles
             WHERE author_id = ?1 AND status = 'approved'
             ORDER BY id, created_at",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Collected into a Result, NOT filter_map(Result::ok). On 2026-08-04 that
    // pattern turned a transient read error into a validly-signed EMPTY
    // catalog and 419 bundles vanished from every client with no error
    // anywhere. A creator page that silently shows nothing is the same bug in
    // miniature, so a row error fails the request instead.
    let rows: Vec<Value> = stmt
        .query_map([user_id], |r| {
            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "version": r.get::<_, String>(1)?,
                "kind": r.get::<_, String>(2)?,
                "name": r.get::<_, String>(3)?,
                "summary": r.get::<_, Option<String>>(4)?,
                "category": r.get::<_, Option<String>>(5)?,
                "downloads": r.get::<_, i64>(6)?,
                "approvedAt": r.get::<_, Option<i64>>(7)?,
            }))
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let total_downloads: i64 = rows
        .iter()
        .filter_map(|b| b["downloads"].as_i64())
        .sum();

    Ok(Json(json!({
        "handle": handle,
        "displayName": display_name,
        "bio": bio,
        "links": serde_json::from_str::<Value>(&links).unwrap_or(json!([])),
        "avatarSeed": avatar_seed.unwrap_or_else(|| handle.clone()),
        "createdAt": created_at,
        "bundles": rows,
        "totalDownloads": total_downloads,
        "accent": accent,
        "badges": serde_json::from_str::<Value>(&badges).unwrap_or(json!([])),
        "hasAvatar": has_avatar,
    })))
}
