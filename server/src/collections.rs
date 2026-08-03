//! Curated multi-bundle sets, surfaced as shelves in the store.
//!
//! Served UNSIGNED, deliberately. A collection is a list of bundle ids; the app
//! still resolves each id against the signed index and verifies its sha256
//! before installing, so the signature that matters is already in the install
//! path. Signing this too would add a second key-rotation surface for data that
//! grants nothing.

use crate::state::AppState;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde_json::{json, Value};

fn slug_ok(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

pub async fn list(State(state): State<AppState>) -> Result<Json<Value>, StatusCode> {
    let db = state.db.lock();
    let mut stmt = db
        .prepare("SELECT slug, title, blurb FROM collections ORDER BY sort, slug")
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let heads: Vec<(String, String, Option<String>)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .filter_map(Result::ok)
        .collect();
    drop(stmt);

    let mut out = Vec::new();
    for (slug, title, blurb) in heads {
        let mut item_stmt = db
            .prepare("SELECT bundle_id FROM collection_items WHERE slug = ?1 ORDER BY idx")
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let items: Vec<String> = item_stmt
            .query_map([&slug], |r| r.get(0))
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .filter_map(Result::ok)
            .collect();
        out.push(json!({ "slug": slug, "title": title, "blurb": blurb, "items": items }));
    }
    Ok(Json(json!({ "collections": out })))
}

pub async fn upsert(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, String)> {
    crate::admin::require_admin_pub(&state, &headers)
        .map_err(|s| (s, "admin token required".to_string()))?;

    let slug = body.get("slug").and_then(Value::as_str).unwrap_or("");
    if !slug_ok(slug) {
        return Err((StatusCode::BAD_REQUEST, "slug must be 1-64 chars of [a-z0-9-]".into()));
    }
    let title = body.get("title").and_then(Value::as_str).unwrap_or("").trim();
    if title.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "title is required".into()));
    }
    let blurb = body.get("blurb").and_then(Value::as_str);
    let sort = body.get("sort").and_then(Value::as_i64).unwrap_or(0);
    let items: Vec<String> = body
        .get("items")
        .and_then(Value::as_array)
        .ok_or((StatusCode::BAD_REQUEST, "items must be an array".to_string()))?
        .iter()
        .filter_map(|v| v.as_str().map(str::to_string))
        .collect();

    let db = state.db.lock();
    db.execute(
        "INSERT OR REPLACE INTO collections (slug, title, blurb, sort) VALUES (?1,?2,?3,?4)",
        rusqlite::params![slug, title, blurb, sort],
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    // Replace the item list wholesale: an upsert that merged would make
    // removing an item impossible through this endpoint.
    db.execute("DELETE FROM collection_items WHERE slug = ?1", [slug])
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    for (i, id) in items.iter().enumerate() {
        db.execute(
            "INSERT OR REPLACE INTO collection_items (slug, bundle_id, idx) VALUES (?1,?2,?3)",
            rusqlite::params![slug, id, i as i64],
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }
    Ok(Json(json!({ "ok": true })))
}

pub async fn remove(
    State(state): State<AppState>,
    Path(slug): Path<String>,
    headers: HeaderMap,
) -> Result<Json<Value>, StatusCode> {
    crate::admin::require_admin_pub(&state, &headers)?;
    let db = state.db.lock();
    db.execute("DELETE FROM collection_items WHERE slug = ?1", [&slug])
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    db.execute("DELETE FROM collections WHERE slug = ?1", [&slug])
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(json!({ "ok": true })))
}
