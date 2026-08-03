//! Written reviews, alongside the numeric `ratings`.
//!
//! Keyed `(bundle_id, user_id)` with no version, matching `ratings`: a review is
//! of the bundle, so re-publishing must not wipe it, and `INSERT OR REPLACE`
//! makes re-reviewing replace rather than stack with no application-level check
//! that could race.
//!
//! Moderation is a soft `hidden` flag, not a delete: an admin hiding abuse
//! should not also destroy the evidence, and the row's primary key is what
//! stops the same user simply re-posting into a fresh row.
//!
//! NOT gated on having installed the bundle. There is no per-user install
//! record anywhere — `bundles.downloads` is a bare counter — so that gate is
//! not implementable without a new table, and pretending otherwise would
//! misrepresent what this endpoint actually enforces.

use crate::auth::bearer_user;
use crate::db::now;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde_json::{json, Value};
use std::collections::HashMap;

const MAX_BODY: usize = 1000;

pub async fn list(
    State(state): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<Value>, StatusCode> {
    let id = q.get("id").cloned().unwrap_or_default();
    let db = state.db.lock();
    let mut stmt = db
        .prepare(
            "SELECT u.email, r.body, r.created_at,
                    (SELECT stars FROM ratings g WHERE g.bundle_id = r.bundle_id AND g.user_id = r.user_id)
             FROM reviews r JOIN users u ON u.id = r.user_id
             WHERE r.bundle_id = ?1 AND r.hidden = 0
             ORDER BY r.created_at DESC",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let rows: Vec<Value> = stmt
        .query_map([&id], |r| {
            let email: String = r.get(0)?;
            let masked = format!("{}***", email.chars().take(3).collect::<String>());
            Ok(json!({
                "author": masked,
                "body": r.get::<_, String>(1)?,
                "createdAt": r.get::<_, i64>(2)?,
                "stars": r.get::<_, Option<i64>>(3)?,
            }))
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .filter_map(Result::ok)
        .collect();
    Ok(Json(json!({ "reviews": rows })))
}

pub async fn post(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let user_id = bearer_user(&state, &headers).map_err(|s| (s, "auth required".to_string()))?;
    let id = body.get("id").and_then(Value::as_str).unwrap_or("");
    let text = body.get("body").and_then(Value::as_str).unwrap_or("").trim();

    if text.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "review body must not be blank".into()));
    }
    if text.chars().count() > MAX_BODY {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("review must be at most {MAX_BODY} characters"),
        ));
    }

    let db = state.db.lock();
    // Any approved version counts — a review targets the bundle id, not a
    // release. This also covers "bundle does not exist" for free: an unknown id
    // has zero approved rows, same as a pending-only one.
    let approved: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM bundles WHERE id = ?1 AND status = 'approved')",
            [id],
            |r| r.get(0),
        )
        .unwrap_or(false);
    if !approved {
        return Err((
            StatusCode::BAD_REQUEST,
            "bundle does not exist or is not approved".into(),
        ));
    }

    db.execute(
        "INSERT OR REPLACE INTO reviews (bundle_id, user_id, body, created_at, hidden)
         VALUES (?1,?2,?3,?4,0)",
        rusqlite::params![id, user_id, text, now()],
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(json!({ "ok": true })))
}

pub async fn hide(
    State(state): State<AppState>,
    Path((bundle_id, user_id)): Path<(String, i64)>,
    headers: HeaderMap,
) -> Result<Json<Value>, StatusCode> {
    crate::admin::require_admin_pub(&state, &headers)?;
    let db = state.db.lock();
    db.execute(
        "UPDATE reviews SET hidden = 1 WHERE bundle_id = ?1 AND user_id = ?2",
        rusqlite::params![bundle_id, user_id],
    )
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(json!({ "ok": true })))
}
