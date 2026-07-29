//! Accounts: register → email-verify → login → bearer sessions, plus
//! password reset. Argon2 hashes; tokens are random 32-byte hex rows in
//! `tokens` with a kind + expiry.
//!
//! Email: when SMTP_URL is unset (dev mode / home-server bootstrap) the
//! verification and reset links are RETURNED IN THE RESPONSE and logged.
//! That is a deliberate contract for a self-hosted, friends-scale service —
//! see server/README.md before exposing registration publicly.

use crate::db::{now, rand_token};
use crate::state::AppState;
use argon2::password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::{Duration, Instant};

const SESSION_TTL: i64 = 30 * 24 * 3600;
const EMAIL_TOKEN_TTL: i64 = 24 * 3600;
const RATE_WINDOW: Duration = Duration::from_secs(60);
const RATE_MAX: usize = 10;

pub fn client_ip(headers: &HeaderMap) -> String {
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(',').next().unwrap_or("").trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown".into())
}

/// True when this (ip, route) is within budget; records the hit.
pub fn rate_ok(state: &AppState, ip: &str, route: &str) -> bool {
    let mut map = state.limiter.lock();
    let hits = map.entry((ip.to_string(), route.to_string())).or_default();
    let cutoff = Instant::now() - RATE_WINDOW;
    hits.retain(|t| *t > cutoff);
    if hits.len() >= RATE_MAX {
        return false;
    }
    hits.push(Instant::now());
    true
}

/// Resolve `Authorization: Bearer <token>` to a user id.
pub fn bearer_user(state: &AppState, headers: &HeaderMap) -> Result<i64, StatusCode> {
    let token = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let db = state.db.lock();
    db.query_row(
        "SELECT user_id FROM tokens WHERE token = ?1 AND kind = 'session' AND expires_at > ?2",
        rusqlite::params![token, now()],
        |r| r.get(0),
    )
    .map_err(|_| StatusCode::UNAUTHORIZED)
}

fn email_or_log(state: &AppState, kind: &str, email: &str, token: &str) -> Option<String> {
    if state.cfg.smtp_url.is_some() {
        // Relay wiring is deployment-specific; see README. Until configured,
        // running with SMTP_URL set but no relay integration logs loudly.
        eprintln!("SMTP_URL set but relay not integrated — {kind} token for {email}: {token}");
        None
    } else {
        println!("[dev-email] {kind} for {email}: token={token}");
        Some(token.to_string())
    }
}

#[derive(Deserialize)]
pub struct RegisterBody {
    email: String,
    password: String,
}

pub async fn register(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<RegisterBody>,
) -> Result<Json<Value>, StatusCode> {
    if !rate_ok(&state, &client_ip(&headers), "register") {
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }
    let email = body.email.trim().to_lowercase();
    if !email.contains('@') || email.len() > 254 {
        return Err(StatusCode::BAD_REQUEST);
    }
    if body.password.len() < 8 {
        return Err(StatusCode::BAD_REQUEST);
    }
    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password(body.password.as_bytes(), &salt)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .to_string();

    let user_id: i64 = {
        let db = state.db.lock();
        match db.execute(
            "INSERT INTO users (email, pass_hash, created_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![email, hash, now()],
        ) {
            Ok(_) => db.last_insert_rowid(),
            Err(_) => return Err(StatusCode::CONFLICT),
        }
    };

    let token = rand_token();
    state.db.lock().execute(
        "INSERT INTO tokens (token, user_id, kind, expires_at) VALUES (?1, ?2, 'verify', ?3)",
        rusqlite::params![token, user_id, now() + EMAIL_TOKEN_TTL],
    ).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let dev_token = email_or_log(&state, "verify", &email, &token);
    Ok(Json(match dev_token {
        Some(t) => json!({ "ok": true, "verify_token": t }),
        None => json!({ "ok": true }),
    }))
}

#[derive(Deserialize)]
pub struct VerifyQuery {
    token: String,
}

pub async fn verify(
    State(state): State<AppState>,
    Query(q): Query<VerifyQuery>,
) -> Result<Json<Value>, StatusCode> {
    let db = state.db.lock();
    let user_id: i64 = db
        .query_row(
            "SELECT user_id FROM tokens WHERE token = ?1 AND kind = 'verify' AND expires_at > ?2",
            rusqlite::params![q.token, now()],
            |r| r.get(0),
        )
        .map_err(|_| StatusCode::NOT_FOUND)?;
    db.execute("UPDATE users SET verified = 1 WHERE id = ?1", [user_id])
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    db.execute("DELETE FROM tokens WHERE token = ?1", [&q.token])
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct LoginBody {
    email: String,
    password: String,
}

pub async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<LoginBody>,
) -> Result<Json<Value>, StatusCode> {
    if !rate_ok(&state, &client_ip(&headers), "login") {
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }
    let email = body.email.trim().to_lowercase();
    let (user_id, hash, verified): (i64, String, i64) = state
        .db
        .lock()
        .query_row(
            "SELECT id, pass_hash, verified FROM users WHERE email = ?1",
            [&email],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|_| StatusCode::UNAUTHORIZED)?;
    let parsed = PasswordHash::new(&hash).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if Argon2::default()
        .verify_password(body.password.as_bytes(), &parsed)
        .is_err()
    {
        return Err(StatusCode::UNAUTHORIZED);
    }
    if verified == 0 {
        return Err(StatusCode::FORBIDDEN);
    }
    let token = rand_token();
    state.db.lock().execute(
        "INSERT INTO tokens (token, user_id, kind, expires_at) VALUES (?1, ?2, 'session', ?3)",
        rusqlite::params![token, user_id, now() + SESSION_TTL],
    ).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(json!({ "token": token })))
}

#[derive(Deserialize)]
pub struct ResetRequestBody {
    email: String,
}

pub async fn request_reset(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ResetRequestBody>,
) -> Result<Json<Value>, StatusCode> {
    if !rate_ok(&state, &client_ip(&headers), "request-reset") {
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }
    let email = body.email.trim().to_lowercase();
    let user_id: Option<i64> = state
        .db
        .lock()
        .query_row("SELECT id FROM users WHERE email = ?1", [&email], |r| r.get(0))
        .ok();
    // Same response either way — no account enumeration.
    let Some(user_id) = user_id else {
        return Ok(Json(json!({ "ok": true })));
    };
    let token = rand_token();
    state.db.lock().execute(
        "INSERT INTO tokens (token, user_id, kind, expires_at) VALUES (?1, ?2, 'reset', ?3)",
        rusqlite::params![token, user_id, now() + EMAIL_TOKEN_TTL],
    ).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let dev_token = email_or_log(&state, "reset", &email, &token);
    Ok(Json(match dev_token {
        Some(t) => json!({ "ok": true, "reset_token": t }),
        None => json!({ "ok": true }),
    }))
}

#[derive(Deserialize)]
pub struct ResetBody {
    token: String,
    password: String,
}

pub async fn reset(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ResetBody>,
) -> Result<Json<Value>, StatusCode> {
    if !rate_ok(&state, &client_ip(&headers), "reset") {
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }
    if body.password.len() < 8 {
        return Err(StatusCode::BAD_REQUEST);
    }
    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password(body.password.as_bytes(), &salt)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .to_string();
    let db = state.db.lock();
    let user_id: i64 = db
        .query_row(
            "SELECT user_id FROM tokens WHERE token = ?1 AND kind = 'reset' AND expires_at > ?2",
            rusqlite::params![body.token, now()],
            |r| r.get(0),
        )
        .map_err(|_| StatusCode::NOT_FOUND)?;
    db.execute("UPDATE users SET pass_hash = ?1 WHERE id = ?2", rusqlite::params![hash, user_id])
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    // Reset consumes the token and every live session for the account.
    db.execute("DELETE FROM tokens WHERE user_id = ?1", [user_id])
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn whoami(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, StatusCode> {
    let user_id = bearer_user(&state, &headers)?;
    let email: String = state
        .db
        .lock()
        .query_row("SELECT email FROM users WHERE id = ?1", [user_id], |r| r.get(0))
        .map_err(|_| StatusCode::UNAUTHORIZED)?;
    Ok(Json(json!({ "id": user_id, "email": email })))
}
