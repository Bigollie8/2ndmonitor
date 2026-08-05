//! The forum: topics and flat replies.
//!
//! Same shape as comments, and for the same reasons — PLAIN TEXT, no
//! markdown, no HTML, no auto-linking. One decision that kills XSS,
//! formatting abuse and link spam at once instead of three defences that
//! each have to be right. Replies are flat: threading doubles the data model
//! and the UI for marginal value at this size.
//!
//! A topic may hang off a bundle (`bundleId`) or stand alone in the general
//! board. That is the only structure there is — no categories, no forums
//! within forums, nothing that needs administering before anyone can post.
//!
//! Posting requires a claimed handle, the same rule publishing and commenting
//! follow, so every visible contribution carries a name.
use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::auth::bearer_user;
use crate::AppState;

pub const MAX_TITLE: usize = 120;
pub const MAX_BODY: usize = 4000;

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// The poster's user id, once their handle is confirmed. Mirrors
/// comments::require_handle so both surfaces enforce identity identically.
fn require_handle(state: &AppState, headers: &HeaderMap) -> Result<i64, (StatusCode, String)> {
    let user = bearer_user(state, headers).map_err(|s| (s, "sign in first".to_string()))?;
    let db = state.db.lock();
    let handle: Option<String> = db
        .query_row("SELECT handle FROM users WHERE id = ?1 AND suspended = 0", [user], |r| r.get(0))
        .map_err(|_| (StatusCode::FORBIDDEN, "account unavailable".to_string()))?;
    if handle.is_none() {
        return Err((StatusCode::FORBIDDEN, "claim a handle before posting".into()));
    }
    Ok(user)
}

/// Topics, newest activity first. Optionally scoped to one bundle.
pub async fn list_topics(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<Value>, StatusCode> {
    // Resolved BEFORE the lock: bearer_user locks state.db itself and
    // parking_lot's Mutex is not reentrant, so calling it while holding the
    // guard deadlocks the whole server.
    let caller = bearer_user(&state, &headers).ok();
    let bundle = q.get("bundleId").cloned();

    let db = state.db.lock();
    let mut stmt = db
        .prepare(
            "SELECT t.id, t.title, t.body, t.bundle_id, t.created_at, t.last_at, t.reply_count,
                    u.handle, u.display_name, u.avatar_seed, u.accent
             FROM topics t JOIN users u ON u.id = t.author_id
             WHERE t.hidden = 0 AND u.suspended = 0
               AND (?1 IS NULL OR t.bundle_id = ?1)
               -- Blocking is enforced HERE, not in the client, so a modified
               -- client cannot un-block anyone.
               AND (?2 IS NULL OR t.author_id NOT IN
                    (SELECT blocked_id FROM blocks WHERE user_id = ?2))
             ORDER BY t.last_at DESC
             LIMIT 100",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let rows: Vec<Value> = stmt
        .query_map(rusqlite::params![bundle, caller], |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "title": r.get::<_, String>(1)?,
                "body": r.get::<_, String>(2)?,
                "bundleId": r.get::<_, Option<String>>(3)?,
                "createdAt": r.get::<_, i64>(4)?,
                "lastAt": r.get::<_, i64>(5)?,
                "replyCount": r.get::<_, i64>(6)?,
                "handle": r.get::<_, Option<String>>(7)?,
                "displayName": r.get::<_, Option<String>>(8)?,
                "avatarSeed": r.get::<_, Option<String>>(9)?,
                "accent": r.get::<_, Option<String>>(10)?,
            }))
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(json!({ "topics": rows })))
}

pub async fn create_topic(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let user = require_handle(&state, &headers)?;
    let title = body.get("title").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    let text = body.get("body").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    let bundle = body.get("bundleId").and_then(|v| v.as_str()).map(|s| s.to_string());

    if title.is_empty() || text.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "a topic needs a title and a body".into()));
    }
    if title.chars().count() > MAX_TITLE {
        return Err((StatusCode::BAD_REQUEST, format!("title must be at most {MAX_TITLE} characters")));
    }
    if text.chars().count() > MAX_BODY {
        return Err((StatusCode::BAD_REQUEST, format!("body must be at most {MAX_BODY} characters")));
    }

    let ts = now();
    let db = state.db.lock();
    db.execute(
        "INSERT INTO topics (author_id, title, body, bundle_id, created_at, last_at, reply_count)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, 0)",
        rusqlite::params![user, title, text, bundle, ts],
    )
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "write failed".to_string()))?;

    Ok(Json(json!({ "ok": true, "id": db.last_insert_rowid() })))
}

/// One topic's replies, oldest first — a conversation reads forwards.
pub async fn list_replies(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<Value>, StatusCode> {
    let caller = bearer_user(&state, &headers).ok();
    let topic: i64 = q
        .get("topicId")
        .and_then(|s| s.parse().ok())
        .ok_or(StatusCode::BAD_REQUEST)?;

    let db = state.db.lock();
    let mut stmt = db
        .prepare(
            "SELECT r.id, r.body, r.created_at, u.handle, u.display_name, u.avatar_seed, u.accent
             FROM topic_replies r JOIN users u ON u.id = r.author_id
             WHERE r.topic_id = ?1 AND r.hidden = 0 AND u.suspended = 0
               AND (?2 IS NULL OR r.author_id NOT IN
                    (SELECT blocked_id FROM blocks WHERE user_id = ?2))
             ORDER BY r.created_at ASC
             LIMIT 500",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let rows: Vec<Value> = stmt
        .query_map(rusqlite::params![topic, caller], |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "body": r.get::<_, String>(1)?,
                "createdAt": r.get::<_, i64>(2)?,
                "handle": r.get::<_, Option<String>>(3)?,
                "displayName": r.get::<_, Option<String>>(4)?,
                "avatarSeed": r.get::<_, Option<String>>(5)?,
                "accent": r.get::<_, Option<String>>(6)?,
            }))
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(json!({ "replies": rows })))
}

pub async fn create_reply(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let user = require_handle(&state, &headers)?;
    let topic = body.get("topicId").and_then(|v| v.as_i64())
        .ok_or((StatusCode::BAD_REQUEST, "topicId required".to_string()))?;
    let text = body.get("body").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();

    if text.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "reply must not be blank".into()));
    }
    if text.chars().count() > MAX_BODY {
        return Err((StatusCode::BAD_REQUEST, format!("reply must be at most {MAX_BODY} characters")));
    }

    let ts = now();
    let db = state.db.lock();

    // A hidden topic accepts no replies: hiding it has to actually stop the
    // conversation, or moderation is theatre.
    let open: i64 = db
        .query_row("SELECT COUNT(*) FROM topics WHERE id = ?1 AND hidden = 0", [topic], |r| r.get(0))
        .unwrap_or(0);
    if open == 0 {
        return Err((StatusCode::NOT_FOUND, "no such topic".into()));
    }

    db.execute(
        "INSERT INTO topic_replies (topic_id, author_id, body, created_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![topic, user, text, ts],
    )
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "write failed".to_string()))?;

    // Denormalised activity, so the topic list sorts without a correlated
    // subquery over every reply.
    db.execute(
        "UPDATE topics SET last_at = ?1, reply_count = reply_count + 1 WHERE id = ?2",
        rusqlite::params![ts, topic],
    )
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "write failed".to_string()))?;

    Ok(Json(json!({ "ok": true })))
}
