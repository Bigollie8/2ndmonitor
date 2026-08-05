//! The shoutbox: a small rolling window of short public messages.
//!
//! Deliberately NOT a chat log. Two constraints make it something one person
//! can own rather than a permanent archive:
//!
//!   * `WINDOW` messages, trimmed on every write. Old shouts are gone, so
//!     there is never a back-catalogue to audit.
//!   * A per-author cooldown, enforced server-side. Flooding is the failure
//!     mode of every shoutbox ever built, and a client-side throttle stops
//!     exactly nobody.
//!
//! Plain text, like comments and the forum, for the same one-decision reason.
//! Posting needs a claimed handle, so no shout is anonymous.
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde_json::{json, Value};

use crate::auth::{bearer_user, client_ip, rate_ok};
use crate::AppState;

pub const MAX_BODY: usize = 240;
/// How many shouts survive. Small on purpose.
pub const WINDOW: i64 = 100;
/// Seconds between one author's shouts.
pub const COOLDOWN: i64 = 10;

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// The current window, oldest first so the client can append and scroll.
pub async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, StatusCode> {
    // Before the lock — parking_lot is not reentrant.
    let caller = bearer_user(&state, &headers).ok();

    let db = state.db.lock();
    let mut stmt = db
        .prepare(
            "SELECT s.id, s.body, s.created_at, u.handle, u.display_name, u.avatar_seed, u.accent, (u.avatar IS NOT NULL)
             FROM shouts s JOIN users u ON u.id = s.author_id
             WHERE s.hidden = 0 AND u.suspended = 0
               AND (?1 IS NULL OR s.author_id NOT IN
                    (SELECT blocked_id FROM blocks WHERE user_id = ?1))
             ORDER BY s.id DESC
             LIMIT ?2",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut rows: Vec<Value> = stmt
        .query_map(rusqlite::params![caller, WINDOW], |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "body": r.get::<_, String>(1)?,
                "createdAt": r.get::<_, i64>(2)?,
                "handle": r.get::<_, Option<String>>(3)?,
                "displayName": r.get::<_, Option<String>>(4)?,
                "avatarSeed": r.get::<_, Option<String>>(5)?,
                "accent": r.get::<_, Option<String>>(6)?,
                "hasAvatar": r.get::<_, bool>(7)?,
            }))
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Queried newest-first so LIMIT takes the right end; reversed so the
    // client renders a conversation reading downwards.
    rows.reverse();
    Ok(Json(json!({ "shouts": rows, "cooldown": COOLDOWN })))
}

pub async fn post(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, String)> {
    // Belt and braces with the per-author cooldown below: that stops one
    // person flooding, this stops one MACHINE cycling accounts.
    if !rate_ok(&state, &client_ip(&headers), "shouts") {
        return Err((StatusCode::TOO_MANY_REQUESTS, "slow down".into()));
    }
    let user = bearer_user(&state, &headers)
        .map_err(|s| (s, "sign in first".to_string()))?;
    let text = body.get("body").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();

    if text.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "shout must not be blank".into()));
    }
    if text.chars().count() > MAX_BODY {
        return Err((StatusCode::BAD_REQUEST, format!("shout must be at most {MAX_BODY} characters")));
    }

    let ts = now();
    let db = state.db.lock();

    let handle: Option<String> = db
        .query_row("SELECT handle FROM users WHERE id = ?1 AND suspended = 0", [user], |r| r.get(0))
        .map_err(|_| (StatusCode::FORBIDDEN, "account unavailable".to_string()))?;
    if handle.is_none() {
        return Err((StatusCode::FORBIDDEN, "claim a handle before shouting".into()));
    }

    // Server-side cooldown. The client also disables its button, but that is
    // courtesy; this is the rule.
    let last: Option<i64> = db
        .query_row(
            "SELECT MAX(created_at) FROM shouts WHERE author_id = ?1",
            [user],
            |r| r.get(0),
        )
        .unwrap_or(None);
    if let Some(prev) = last {
        if ts - prev < COOLDOWN {
            return Err((
                StatusCode::TOO_MANY_REQUESTS,
                format!("wait {} more seconds", COOLDOWN - (ts - prev)),
            ));
        }
    }

    db.execute(
        "INSERT INTO shouts (author_id, body, created_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![user, text, ts],
    )
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "write failed".to_string()))?;

    // Trim to the window on every write, so the table can never grow into an
    // archive. Keeps the newest WINDOW rows including hidden ones — a hidden
    // shout still occupies its slot until it ages out, which is what stops a
    // hide from pulling older messages back into view.
    db.execute(
        "DELETE FROM shouts WHERE id NOT IN
           (SELECT id FROM shouts ORDER BY id DESC LIMIT ?1)",
        [WINDOW],
    )
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "trim failed".to_string()))?;

    Ok(Json(json!({ "ok": true })))
}
