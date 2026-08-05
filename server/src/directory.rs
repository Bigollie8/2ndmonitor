//! The creator directory: everyone who has claimed a handle, browsable and
//! searchable.
//!
//! Only claimed handles appear. An account that has never claimed one has
//! deliberately not joined the public side of the marketplace, and listing it
//! would publish a person who never asked to be published.
//!
//! Unauthenticated and unsigned, like every other browse surface — only
//! `/index.json` is signed.
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::AppState;

/// Hard ceiling on one page. The client asks for what it wants; this is what
/// stops a request asking for everything.
const MAX_LIMIT: i64 = 100;

pub async fn list(
    State(state): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<Value>, StatusCode> {
    let search = q.get("q").map(|s| s.trim().to_lowercase()).unwrap_or_default();
    let limit = q
        .get("limit")
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(60)
        .clamp(1, MAX_LIMIT);

    let db = state.db.lock();

    // Published counts come from the same approved-only rule the index uses,
    // so the directory can never advertise work the catalog will not show.
    // LIKE with an escaped pattern: a handle is [a-z0-9_-] but a display
    // name is not, and '%' in a search box must mean a literal percent.
    let pattern = format!("%{}%", search.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"));

    let mut stmt = db
        .prepare(
            "SELECT u.handle, u.display_name, u.avatar_seed, u.accent, u.badges, u.created_at,
                    (SELECT COUNT(DISTINCT b.id) FROM bundles b
                      WHERE b.author_id = u.id AND b.status = 'approved') AS published,
                    (SELECT COUNT(*) FROM follows f WHERE f.creator_id = u.id) AS followers
             FROM users u
             WHERE u.handle IS NOT NULL AND u.suspended = 0
               AND (?1 = '' OR u.handle LIKE ?2 ESCAPE '\\'
                    OR LOWER(COALESCE(u.display_name, '')) LIKE ?2 ESCAPE '\\')
             ORDER BY published DESC, followers DESC, u.created_at ASC
             LIMIT ?3",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Result-collected, never filter_map(Result::ok) — the 2026-08-04 rule:
    // a row error must fail the request, not silently shrink the directory.
    let rows: Vec<Value> = stmt
        .query_map(rusqlite::params![search, pattern, limit], |r| {
            let badges: String = r.get(4)?;
            Ok(json!({
                "handle": r.get::<_, String>(0)?,
                "displayName": r.get::<_, Option<String>>(1)?,
                "avatarSeed": r.get::<_, Option<String>>(2)?,
                "accent": r.get::<_, Option<String>>(3)?,
                "badges": serde_json::from_str::<Value>(&badges).unwrap_or(json!([])),
                "createdAt": r.get::<_, i64>(5)?,
                "published": r.get::<_, i64>(6)?,
                "followers": r.get::<_, i64>(7)?,
            }))
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(json!({ "creators": rows })))
}
