//! Comments, blocks, and reports.
//!
//! Comments are FLAT and PLAIN TEXT, both deliberately.
//!
//! Flat because threading doubles the data model and the UI for marginal
//! value at this size. Plain text — no markdown, no HTML, no auto-linking —
//! because that one decision kills XSS, formatting abuse and link spam at
//! once, rather than needing three separate defences that each have to be
//! right. The client renders the body as text, so there is nothing to escape
//! and nothing to sanitise.
//!
//! Distinct from `reviews`, which stay one-per-user and star-linked.
//!
//! Moderation here is tooling, not policy: hide, block, report, suspend. It
//! ships with the feature rather than after it, because a public comment
//! surface without any of it is not something that can responsibly exist.

use crate::auth::{bearer_user, client_ip, rate_ok};
use crate::db::now;
use crate::state::AppState;
use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde_json::{json, Value};
use std::collections::HashMap;

const MAX_BODY: usize = 1000;

/// Comments on one bundle, newest first.
///
/// Hidden comments are excluded, as are comments by anyone the caller has
/// blocked — enforced HERE rather than in the client, so a modified client
/// cannot bypass a block.
pub async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<Value>, StatusCode> {
    let id = q.get("id").cloned().unwrap_or_default();
    // Resolved before the lock: bearer_user locks state.db and parking_lot is
    // not reentrant, so calling it while holding the guard deadlocks.
    let caller = bearer_user(&state, &headers).ok();
    let db = state.db.lock();

    let mut stmt = db
        .prepare(
            "SELECT c.id, u.handle, u.display_name, c.body, c.created_at, c.user_id
             FROM comments c JOIN users u ON u.id = c.user_id
             WHERE c.bundle_id = ?1 AND c.hidden = 0 AND u.suspended = 0
             ORDER BY c.created_at DESC
             LIMIT 200",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Collected into a Result, never filter_map(Result::ok): a silently empty
    // list is the 2026-08-04 index bug in miniature.
    let rows = stmt
        .query_map([&id], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, i64>(5)?,
            ))
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let blocked: Vec<i64> = match caller {
        Some(uid) => {
            let mut s = db
                .prepare("SELECT blocked_id FROM blocks WHERE user_id = ?1")
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            let v = s
                .query_map([uid], |r| r.get::<_, i64>(0))
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            v
        }
        None => Vec::new(),
    };

    let comments: Vec<Value> = rows
        .into_iter()
        .filter(|(_, _, _, _, _, author)| !blocked.contains(author))
        .map(|(cid, handle, display, body, created, _)| {
            json!({
                "id": cid,
                "handle": handle,
                "displayName": display,
                "body": body,
                "createdAt": created,
            })
        })
        .collect();

    Ok(Json(json!({ "comments": comments })))
}

/// Post a comment. Requires a session and a claimed handle — the same rule
/// publishing follows, so every visible contribution has a name attached.
pub async fn post(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let user = bearer_user(&state, &headers).map_err(|s| (s, "auth required".to_string()))?;
    if !rate_ok(&state, &client_ip(&headers), "comment") {
        return Err((StatusCode::TOO_MANY_REQUESTS, "slow down".into()));
    }
    let bundle_id = body.get("id").and_then(Value::as_str).unwrap_or("").to_string();
    let text = body.get("body").and_then(Value::as_str).unwrap_or("").trim().to_string();

    if bundle_id.is_empty() || bundle_id.len() > 64 {
        return Err((StatusCode::BAD_REQUEST, "bundle id required".into()));
    }
    if text.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "comment must not be blank".into()));
    }
    if text.chars().count() > MAX_BODY {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("comment must be at most {MAX_BODY} characters"),
        ));
    }

    let db = state.db.lock();
    let (handle, suspended): (Option<String>, i64) = db
        .query_row("SELECT handle, suspended FROM users WHERE id = ?1", [user], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .map_err(|_| (StatusCode::NOT_FOUND, "no such account".to_string()))?;
    if suspended != 0 {
        return Err((StatusCode::FORBIDDEN, "your account is suspended".into()));
    }
    if handle.is_none() {
        return Err((StatusCode::FORBIDDEN, "choose a handle before commenting".into()));
    }

    db.execute(
        "INSERT INTO comments (bundle_id, user_id, body, created_at, hidden) VALUES (?1,?2,?3,?4,0)",
        rusqlite::params![bundle_id, user, text, now()],
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(json!({ "ok": true })))
}

/// Block or unblock a creator. Their comments stop appearing for you.
pub async fn set_block(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let user = bearer_user(&state, &headers).map_err(|s| (s, "auth required".to_string()))?;
    let handle = crate::handle::normalise(body.get("handle").and_then(Value::as_str).unwrap_or(""));
    let blocking = body.get("blocking").and_then(Value::as_bool).unwrap_or(true);

    let db = state.db.lock();
    let target: i64 = db
        .query_row("SELECT id FROM users WHERE handle = ?1", [&handle], |r| r.get(0))
        .map_err(|_| (StatusCode::NOT_FOUND, "no such creator".to_string()))?;
    if target == user {
        return Err((StatusCode::BAD_REQUEST, "you cannot block yourself".into()));
    }

    if blocking {
        db.execute(
            "INSERT OR IGNORE INTO blocks (user_id, blocked_id, created_at) VALUES (?1,?2,?3)",
            rusqlite::params![user, target, now()],
        )
    } else {
        db.execute(
            "DELETE FROM blocks WHERE user_id = ?1 AND blocked_id = ?2",
            rusqlite::params![user, target],
        )
    }
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(json!({ "ok": true, "blocking": blocking })))
}

/// Report something for moderation.
///
/// Deliberately cheap to file and impossible to file anonymously: a report
/// carries the reporter's id so a person who files hundreds is itself
/// visible in the queue.
pub async fn report(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let user = bearer_user(&state, &headers).map_err(|s| (s, "auth required".to_string()))?;
    if !rate_ok(&state, &client_ip(&headers), "report") {
        return Err((StatusCode::TOO_MANY_REQUESTS, "slow down".into()));
    }
    let kind = body.get("targetKind").and_then(Value::as_str).unwrap_or("");
    if !matches!(kind, "comment" | "review" | "bundle" | "creator") {
        return Err((StatusCode::BAD_REQUEST, "targetKind must be comment, review, bundle or creator".into()));
    }
    let target = body.get("targetId").and_then(Value::as_str).unwrap_or("").to_string();
    if target.is_empty() || target.len() > 128 {
        return Err((StatusCode::BAD_REQUEST, "targetId required".into()));
    }
    let reason = body.get("reason").and_then(Value::as_str).unwrap_or("").trim().to_string();
    if reason.chars().count() > 500 {
        return Err((StatusCode::BAD_REQUEST, "reason must be at most 500 characters".into()));
    }

    state
        .db
        .lock()
        .execute(
            "INSERT INTO reports (target_kind, target_id, reporter_id, reason, created_at, status)
             VALUES (?1,?2,?3,?4,?5,'open')",
            rusqlite::params![kind, target, user, reason, now()],
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(json!({ "ok": true })))
}
