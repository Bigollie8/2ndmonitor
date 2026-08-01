//! Star ratings — one per user per bundle, enforced by the `(bundle_id,
//! user_id)` primary key via `INSERT OR REPLACE` so re-rating replaces
//! rather than stacks, with no application-level check that could race.
//!
//! Deliberately NOT part of `index.rs`'s signed payload: the index signs the
//! exact `bundles` array string once and the app verifies that raw
//! substring, so anything that changes on every vote does not belong in it.
//! Ratings are public, unsigned browse data — same trust tier as download
//! counts.

use crate::auth::bearer_user;
use crate::db::now;
use crate::state::AppState;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Map, Value};

#[derive(Deserialize)]
pub struct RateBody {
    id: String,
    /// Deliberately `Value`, not `i64`: a plain `i64` field would let Axum's
    /// generic JSON-rejection reply for `3.5` or `"5"` stand in for real
    /// validation. Reading it as `Value` and checking it in `validate_stars`
    /// means every rejection — wrong type, fractional, out of range — goes
    /// through the one place that produces the specific message callers see.
    stars: Value,
}

/// `Value::as_i64` returns `None` for anything serde_json stored as a float
/// (including a whole-looking `3.0` — JSON literals with a decimal point are
/// parsed as `Float`, never coerced back to an integer variant) and for any
/// non-number JSON type, so this rejects `3.5`, `"5"`, `true`, `null`, etc.
/// in one pass alongside the 1-5 range check.
fn validate_stars(v: &Value) -> Result<i64, String> {
    let n = v.as_i64().ok_or_else(|| "stars must be an integer from 1 to 5".to_string())?;
    if !(1..=5).contains(&n) {
        return Err("stars must be an integer from 1 to 5".to_string());
    }
    Ok(n)
}

pub async fn rate(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<RateBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let user_id = bearer_user(&state, &headers).map_err(|s| (s, "auth required".into()))?;
    let stars = validate_stars(&body.stars).map_err(|e| (StatusCode::BAD_REQUEST, e))?;

    let db = state.db.lock();
    // Any approved version counts — a rating targets the bundle id, not a
    // specific release (see the `bundle_id` column comment in db.rs), and
    // this single check also covers "bundle does not exist at all" for free:
    // a nonexistent id has zero approved rows, same as a pending-only one.
    let approved: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM bundles WHERE id = ?1 AND status = 'approved')",
            [&body.id],
            |r| r.get(0),
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if !approved {
        return Err((StatusCode::BAD_REQUEST, "bundle does not exist or is not approved".into()));
    }

    db.execute(
        "INSERT OR REPLACE INTO ratings (bundle_id, user_id, stars, rated_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![body.id, user_id, stars, now()],
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(json!({ "ok": true })))
}

pub async fn ratings(State(state): State<AppState>) -> Result<Json<Value>, StatusCode> {
    let db = state.db.lock();
    let mut stmt = db
        .prepare(
            "SELECT r.bundle_id, AVG(r.stars), COUNT(*)
             FROM ratings r
             WHERE EXISTS (SELECT 1 FROM bundles b WHERE b.id = r.bundle_id AND b.status = 'approved')
             GROUP BY r.bundle_id",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let rows = stmt
        .query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?, r.get::<_, i64>(2)?))
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut out = Map::new();
    for row in rows {
        let (bundle_id, avg, count) = row.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        // Rounded server-side to one decimal so every client (app, web,
        // whatever comes later) renders the identical number instead of each
        // picking its own rounding.
        let avg_rounded = (avg * 10.0).round() / 10.0;
        out.insert(bundle_id, json!({ "avg": avg_rounded, "count": count }));
    }
    Ok(Json(Value::Object(out)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_stars_accepts_1_to_5_rejects_everything_else() {
        for ok in 1i64..=5 {
            assert_eq!(validate_stars(&json!(ok)), Ok(ok));
        }
        assert!(validate_stars(&json!(0)).is_err());
        assert!(validate_stars(&json!(6)).is_err());
        assert!(validate_stars(&json!(3.5)).is_err());
        assert!(validate_stars(&json!("5")).is_err());
        assert!(validate_stars(&json!(null)).is_err());
    }
}
