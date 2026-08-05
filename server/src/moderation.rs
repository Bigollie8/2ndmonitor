//! The admin side of moderation: read the queue, act on it.
//!
//! Every action here is reversible except none of them are destructive.
//! Hiding a comment sets a flag rather than deleting the row, and suspending
//! a creator hides their work rather than erasing it — an admin dealing with
//! abuse should not also be destroying the evidence of it, and the row's
//! primary key is what stops the same person simply re-posting into a fresh
//! one.

use crate::state::AppState;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde_json::{json, Value};

/// Open reports, newest first, with enough context to act without a second
/// request.
pub async fn queue(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, String)> {
    // Moderators read the queue -- triaging reports is the everyday job, and
    // requiring an admin for it would mean nobody but the owner ever looks.
    crate::roles::require(&state, &headers, crate::roles::Role::Moderator)
        .map_err(|s| (s, "you do not have permission for that".to_string()))?;
    let db = state.db.lock();
    let mut stmt = db
        .prepare(
            "SELECT r.id, r.target_kind, r.target_id, r.reason, r.created_at, u.handle
             FROM reports r LEFT JOIN users u ON u.id = r.reporter_id
             WHERE r.status = 'open'
             ORDER BY r.created_at DESC
             LIMIT 200",
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let rows = stmt
        .query_map([], |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "targetKind": r.get::<_, String>(1)?,
                "targetId": r.get::<_, String>(2)?,
                "reason": r.get::<_, String>(3)?,
                "createdAt": r.get::<_, i64>(4)?,
                "reportedBy": r.get::<_, Option<String>>(5)?,
            }))
        })
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(json!({ "reports": rows })))
}

/// Act on a report, or act directly.
///
/// Actions: `hide-comment`, `unhide-comment`, `hide-review`, `suspend`,
/// `unsuspend`, `rename-handle`, `resolve`.
pub async fn act(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let action = body.get("action").and_then(Value::as_str).unwrap_or("");

    // Content actions need a moderator; anything touching a PERSON or their
    // permissions needs an admin. Enforced here rather than in the UI --
    // a modified client is not a hypothetical, and this is the only place
    // that decision is safe to make.
    let needed = match action {
        "suspend" | "unsuspend" | "rename-handle" | "grant-badge" | "revoke-badge"
        | "set-role" => crate::roles::Role::Admin,
        _ => crate::roles::Role::Moderator,
    };
    let actor = crate::roles::require(&state, &headers, needed)
        .map_err(|s| (s, "you do not have permission for that".to_string()))?;

    let db = state.db.lock();

    match action {
        "hide-comment" | "unhide-comment" => {
            let id = body.get("id").and_then(Value::as_i64)
                .ok_or((StatusCode::BAD_REQUEST, "id required".to_string()))?;
            let hidden = i64::from(action == "hide-comment");
            db.execute("UPDATE comments SET hidden = ?1 WHERE id = ?2", rusqlite::params![hidden, id])
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        }
        "hide-review" => {
            let bundle = body.get("bundleId").and_then(Value::as_str).unwrap_or("");
            let handle = crate::handle::normalise(body.get("handle").and_then(Value::as_str).unwrap_or(""));
            db.execute(
                "UPDATE reviews SET hidden = 1
                 WHERE bundle_id = ?1 AND user_id = (SELECT id FROM users WHERE handle = ?2)",
                rusqlite::params![bundle, handle],
            )
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        }
        "suspend" | "unsuspend" => {
            let handle = crate::handle::normalise(body.get("handle").and_then(Value::as_str).unwrap_or(""));
            let suspended = i64::from(action == "suspend");
            let n = db
                .execute("UPDATE users SET suspended = ?1 WHERE handle = ?2", rusqlite::params![suspended, handle])
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            if n == 0 {
                return Err((StatusCode::NOT_FOUND, "no such creator".into()));
            }
        }
        "rename-handle" => {
            // The one path that can change a handle. Self-service renaming
            // would let someone shed a reputation and would rot every link to
            // their work, so it lives here.
            let from = crate::handle::normalise(body.get("handle").and_then(Value::as_str).unwrap_or(""));
            let to_raw = body.get("newHandle").and_then(Value::as_str).unwrap_or("");
            let to = crate::handle::validate(to_raw)
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
            db.execute(
                "UPDATE users SET handle = ?1, avatar_seed = ?1 WHERE handle = ?2",
                rusqlite::params![to, from],
            )
            .map_err(|_| (StatusCode::CONFLICT, "that handle is taken".to_string()))?;
        }
        "hide-topic" | "unhide-topic" => {
            let id = body.get("id").and_then(Value::as_i64)
                .ok_or((StatusCode::BAD_REQUEST, "id required".to_string()))?;
            let hidden = i64::from(action == "hide-topic");
            // Hiding a topic silences its replies too -- list_replies is
            // reached through the topic, and create_reply refuses a hidden
            // one, so the whole thread goes quiet in one action.
            db.execute("UPDATE topics SET hidden = ?1 WHERE id = ?2", rusqlite::params![hidden, id])
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        }
        "hide-reply" | "unhide-reply" => {
            let id = body.get("id").and_then(Value::as_i64)
                .ok_or((StatusCode::BAD_REQUEST, "id required".to_string()))?;
            let hidden = i64::from(action == "hide-reply");
            db.execute("UPDATE topic_replies SET hidden = ?1 WHERE id = ?2", rusqlite::params![hidden, id])
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        }
        "hide-shout" => {
            let id = body.get("id").and_then(Value::as_i64)
                .ok_or((StatusCode::BAD_REQUEST, "id required".to_string()))?;
            db.execute("UPDATE shouts SET hidden = 1 WHERE id = ?1", [id])
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        }
        "remove-avatar" => {
            // The proportionate response to one bad picture. Suspending
            // somebody over their avatar removes all their work too.
            let handle = crate::handle::normalise(body.get("handle").and_then(Value::as_str).unwrap_or(""));
            let n = db
                .execute("UPDATE users SET avatar = NULL WHERE handle = ?1", [&handle])
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            if n == 0 {
                return Err((StatusCode::NOT_FOUND, "no such creator".into()));
            }
        }
        "grant-badge" | "revoke-badge" => {
            // Badges are admin-granted only -- there is no self-service path
            // anywhere, which is the entire point of a badge. Stored as a
            // JSON array so a new kind needs no migration.
            let handle = crate::handle::normalise(body.get("handle").and_then(Value::as_str).unwrap_or(""));
            let badge = body.get("badge").and_then(Value::as_str).unwrap_or("").trim().to_lowercase();
            if badge.is_empty() || badge.len() > 24
                || !badge.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
            {
                return Err((StatusCode::BAD_REQUEST, "badge must be lowercase a-z0-9-".into()));
            }
            let current: String = db
                .query_row("SELECT badges FROM users WHERE handle = ?1", [&handle], |r| r.get(0))
                .map_err(|_| (StatusCode::NOT_FOUND, "no such creator".to_string()))?;
            let mut list: Vec<String> = serde_json::from_str(&current).unwrap_or_default();
            list.retain(|b| b != &badge);
            if action == "grant-badge" {
                list.push(badge);
            }
            let encoded = serde_json::to_string(&list).unwrap_or_else(|_| "[]".into());
            db.execute("UPDATE users SET badges = ?1 WHERE handle = ?2", rusqlite::params![encoded, handle])
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        }
        "set-role" => {
            let handle = crate::handle::normalise(body.get("handle").and_then(Value::as_str).unwrap_or(""));
            let raw = body.get("role").and_then(Value::as_str).unwrap_or("");
            let role = crate::roles::Role::parse(raw);
            if role.as_str() != raw.trim().to_lowercase() && raw.trim().to_lowercase() != "mod" {
                return Err((StatusCode::BAD_REQUEST, "role must be user, moderator or admin".into()));
            }

            // You cannot demote yourself. Not paternalism: an admin who
            // removes their own last privilege has locked everyone out of the
            // panel, and the only way back is the shared token on the server
            // box. Someone ELSE can always demote them.
            if let Some(me) = actor.user_id() {
                let target: Option<i64> = db
                    .query_row("SELECT id FROM users WHERE handle = ?1", [&handle], |r| r.get(0))
                    .ok();
                if target == Some(me) && role < crate::roles::Role::Admin {
                    return Err((
                        StatusCode::BAD_REQUEST,
                        "you cannot remove your own admin role -- ask another admin".into(),
                    ));
                }
            }

            let n = db
                .execute(
                    "UPDATE users SET role = ?1 WHERE handle = ?2",
                    rusqlite::params![role.as_str(), handle],
                )
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            if n == 0 {
                return Err((StatusCode::NOT_FOUND, "no such creator".into()));
            }
        }
        "resolve" => {
            let id = body.get("id").and_then(Value::as_i64)
                .ok_or((StatusCode::BAD_REQUEST, "id required".to_string()))?;
            db.execute("UPDATE reports SET status = 'closed' WHERE id = ?1", [id])
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        }
        _ => return Err((StatusCode::BAD_REQUEST, "unknown action".into())),
    }

    Ok(Json(json!({ "ok": true })))
}
