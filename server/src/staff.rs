//! Staff-facing user management.
//!
//! The list a moderator works from: who exists, what they are, and what has
//! been done to them. Deliberately NOT public — the creator directory
//! (directory.rs) is the public view and shows only people who claimed a
//! handle, while this shows everyone including accounts that never did.
//!
//! Emails are masked here exactly as they are on `/account`. A moderator
//! needs to tell two accounts apart, which a masked address does; they do not
//! need everybody's inbox to do the job.
use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::roles::{require, Role};
use crate::AppState;

const MAX_LIMIT: i64 = 200;

/// Same masking as profiles::masked — first three characters and nothing
/// else. Duplicated rather than shared because loosening one view's masking
/// must never silently loosen the other's.
fn masked(email: &str) -> String {
    let head: String = email.chars().take(3).collect();
    format!("{head}***")
}

pub async fn users(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<Value>, StatusCode> {
    // Resolved before the lock: parking_lot is not reentrant and `require`
    // reads the database.
    require(&state, &headers, Role::Moderator)?;

    let search = q.get("q").map(|s| s.trim().to_lowercase()).unwrap_or_default();
    let limit = q
        .get("limit")
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(100)
        .clamp(1, MAX_LIMIT);
    let pattern = format!(
        "%{}%",
        search.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
    );

    let db = state.db.lock();
    let mut stmt = db
        .prepare(
            "SELECT u.id, u.email, u.handle, u.display_name, u.avatar_seed, u.accent,
                    u.badges, COALESCE(u.role, 'user'), u.suspended, u.verified, u.created_at,
                    (u.avatar IS NOT NULL),
                    (SELECT COUNT(DISTINCT b.id) FROM bundles b
                      WHERE b.author_id = u.id AND b.status = 'approved'),
                    (SELECT COUNT(*) FROM reports r WHERE r.reporter_id = u.id)
             FROM users u
             WHERE (?1 = '' OR LOWER(u.email) LIKE ?2 ESCAPE '\\'
                    OR COALESCE(u.handle, '') LIKE ?2 ESCAPE '\\'
                    OR LOWER(COALESCE(u.display_name, '')) LIKE ?2 ESCAPE '\\')
             ORDER BY u.suspended DESC, u.created_at DESC
             LIMIT ?3",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Result-collected, never filter_map(Result::ok): a moderation list that
    // silently drops rows is worse than one that fails loudly.
    let rows: Vec<Value> = stmt
        .query_map(rusqlite::params![search, pattern, limit], |r| {
            let email: String = r.get(1)?;
            let badges: String = r.get(6)?;
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "email": masked(&email),
                "handle": r.get::<_, Option<String>>(2)?,
                "displayName": r.get::<_, Option<String>>(3)?,
                "avatarSeed": r.get::<_, Option<String>>(4)?,
                "accent": r.get::<_, Option<String>>(5)?,
                "badges": serde_json::from_str::<Value>(&badges).unwrap_or(json!([])),
                "role": r.get::<_, String>(7)?,
                "suspended": r.get::<_, i64>(8)? != 0,
                "verified": r.get::<_, i64>(9)? != 0,
                "createdAt": r.get::<_, i64>(10)?,
                "hasAvatar": r.get::<_, bool>(11)?,
                "published": r.get::<_, i64>(12)?,
                "reportsFiled": r.get::<_, i64>(13)?,
            }))
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(json!({ "users": rows })))
}

/// What the calling client is allowed to show. The UI asks rather than
/// guessing from a badge, so the panel and the server can never disagree
/// about who may do what.
pub async fn whoami(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, StatusCode> {
    let actor = require(&state, &headers, Role::Moderator)?;
    Ok(Json(json!({
        "role": actor.role().as_str(),
        "canModerateContent": true,
        "canManagePeople": actor.role() >= Role::Admin,
    })))
}
