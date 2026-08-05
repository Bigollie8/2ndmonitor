//! Follows and favourites.
//!
//! Both are deliberately asymmetric about what is public:
//!
//! * A follower COUNT is public; the follower LIST is not. Showing who
//!   follows whom is a harassment surface and a moderation job, and nothing
//!   in the product needs it.
//! * A favourite is PRIVATE to the user; only the count is public. That gives
//!   a bundle its social-proof number without creating a public,
//!   user-curated list — which would be user-generated text needing names,
//!   moderation and reporting.
//!
//! Unsigned browse data, like ratings and reviews. Only the index is signed.

use crate::auth::{bearer_user, client_ip, rate_ok};
use crate::db::now;
use crate::state::AppState;
use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde_json::{json, Value};
use std::collections::HashMap;

/// Follow or unfollow, by handle. Idempotent in both directions: pressing
/// follow twice is not an error, and neither is unfollowing someone you do
/// not follow — a UI that got out of sync should converge, not fail.
pub async fn set_follow(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let follower = bearer_user(&state, &headers).map_err(|s| (s, "auth required".to_string()))?;
    if !rate_ok(&state, &client_ip(&headers), "follow") {
        return Err((StatusCode::TOO_MANY_REQUESTS, "slow down".into()));
    }
    let handle = crate::handle::normalise(body.get("handle").and_then(Value::as_str).unwrap_or(""));
    let following = body.get("following").and_then(Value::as_bool).unwrap_or(true);

    let db = state.db.lock();
    let creator: i64 = db
        .query_row(
            "SELECT id FROM users WHERE handle = ?1 AND suspended = 0",
            [&handle],
            |r| r.get(0),
        )
        .map_err(|_| (StatusCode::NOT_FOUND, "no such creator".to_string()))?;
    if creator == follower {
        return Err((StatusCode::BAD_REQUEST, "you cannot follow yourself".into()));
    }

    if following {
        db.execute(
            "INSERT OR IGNORE INTO follows (follower_id, creator_id, created_at) VALUES (?1,?2,?3)",
            rusqlite::params![follower, creator, now()],
        )
    } else {
        db.execute(
            "DELETE FROM follows WHERE follower_id = ?1 AND creator_id = ?2",
            rusqlite::params![follower, creator],
        )
    }
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(json!({ "ok": true, "following": following })))
}

/// Whether the caller follows this creator, plus the public count.
pub async fn follow_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<Value>, StatusCode> {
    let handle = crate::handle::normalise(q.get("handle").map(String::as_str).unwrap_or(""));
    // Resolved BEFORE the lock is taken. bearer_user locks state.db itself,
    // and parking_lot's Mutex is not reentrant — calling it while holding the
    // guard deadlocks the whole server, which is precisely the failure mode
    // that made /index.json hang for 90s on 2026-08-04.
    let caller = bearer_user(&state, &headers).ok();
    let db = state.db.lock();
    let creator: i64 = db
        .query_row("SELECT id FROM users WHERE handle = ?1", [&handle], |r| r.get(0))
        .map_err(|_| StatusCode::NOT_FOUND)?;
    let followers: i64 = db
        .query_row("SELECT COUNT(*) FROM follows WHERE creator_id = ?1", [creator], |r| r.get(0))
        .unwrap_or(0);
    // Unauthenticated is fine here: the count is public and `following` just
    // comes back false, so a signed-out browse still renders the button.
    let following = match caller {
        Some(uid) => db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM follows WHERE follower_id = ?1 AND creator_id = ?2)",
                rusqlite::params![uid, creator],
                |r| r.get::<_, i64>(0),
            )
            .unwrap_or(0)
            != 0,
        None => false,
    };
    Ok(Json(json!({ "handle": handle, "followers": followers, "following": following })))
}

/// Add or remove a favourite. Private to the caller.
pub async fn set_favourite(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let user = bearer_user(&state, &headers).map_err(|s| (s, "auth required".to_string()))?;
    if !rate_ok(&state, &client_ip(&headers), "favourite") {
        return Err((StatusCode::TOO_MANY_REQUESTS, "slow down".into()));
    }
    let id = body.get("id").and_then(Value::as_str).unwrap_or("").to_string();
    if id.is_empty() || id.len() > 64 {
        return Err((StatusCode::BAD_REQUEST, "bundle id required".into()));
    }
    let favourite = body.get("favourite").and_then(Value::as_bool).unwrap_or(true);

    let db = state.db.lock();
    if favourite {
        db.execute(
            "INSERT OR IGNORE INTO favourites (user_id, bundle_id, created_at) VALUES (?1,?2,?3)",
            rusqlite::params![user, id, now()],
        )
    } else {
        db.execute(
            "DELETE FROM favourites WHERE user_id = ?1 AND bundle_id = ?2",
            rusqlite::params![user, id],
        )
    }
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(json!({ "ok": true, "favourite": favourite })))
}

/// The caller's own favourites, plus the public per-bundle counts.
///
/// One response rather than two endpoints because the card needs both at
/// once: "is it mine" drives the filled star, "how many" drives the number
/// beside it, and splitting them would make every card wait on two requests.
pub async fn favourites(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, StatusCode> {
    // Before the lock — see follow_status above for why.
    let caller = bearer_user(&state, &headers).ok();
    let db = state.db.lock();

    let mut counts = serde_json::Map::new();
    {
        let mut stmt = db
            .prepare("SELECT bundle_id, COUNT(*) FROM favourites GROUP BY bundle_id")
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        // Collected into a Result rather than filter_map(Result::ok): a
        // silently empty list is the 2026-08-04 index bug in miniature.
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        for (id, n) in rows {
            counts.insert(id, json!(n));
        }
    }

    let mine: Vec<String> = match caller {
        Some(uid) => {
            let mut s = db
                .prepare("SELECT bundle_id FROM favourites WHERE user_id = ?1")
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            let v = s
                .query_map([uid], |r| r.get::<_, String>(0))
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            v
        }
        None => Vec::new(),
    };

    Ok(Json(json!({ "counts": Value::Object(counts), "mine": mine })))
}

/// The creators the caller follows, newest first.
///
/// This is the one follow LIST that exists: your own. Another creator's
/// follower list stays private -- that is a harassment surface -- but what
/// you yourself chose to follow is yours to see and manage.
pub async fn follows_mine(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, StatusCode> {
    let user = bearer_user(&state, &headers)?;
    let db = state.db.lock();
    let mut stmt = db
        .prepare(
            "SELECT u.handle, u.display_name, u.avatar_seed
             FROM follows f JOIN users u ON u.id = f.creator_id
             WHERE f.follower_id = ?1 AND u.suspended = 0
             ORDER BY f.created_at DESC",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    // Result-collected, never filter_map(Result::ok) -- the 2026-08-04 rule.
    let rows: Vec<Value> = stmt
        .query_map([user], |r| {
            Ok(json!({
                "handle": r.get::<_, Option<String>>(0)?,
                "displayName": r.get::<_, Option<String>>(1)?,
                "avatarSeed": r.get::<_, Option<String>>(2)?,
            }))
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(json!({ "following": rows })))
}

/// Bundle ids published by creators the caller follows, newest first.
///
/// Ids only: the client already has the full catalog and can resolve them to
/// cards itself, so sending bundle rows again would duplicate the index for
/// no gain.
pub async fn feed(State(state): State<AppState>, headers: HeaderMap) -> Result<Json<Value>, StatusCode> {
    let user = bearer_user(&state, &headers)?;
    let db = state.db.lock();
    let mut stmt = db
        .prepare(
            "SELECT DISTINCT b.id FROM bundles b
             JOIN follows f ON f.creator_id = b.author_id
             WHERE f.follower_id = ?1 AND b.status = 'approved'
             ORDER BY b.created_at DESC
             LIMIT 60",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let ids = stmt
        .query_map([user], |r| r.get::<_, String>(0))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(json!({ "ids": ids })))
}
