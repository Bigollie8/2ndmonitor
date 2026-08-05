//! Accounts: register → email-verify → login → bearer sessions, plus
//! password reset. Argon2 hashes; tokens are random 32-byte hex rows in
//! `tokens` with a kind + expiry.
//!
//! Email: delivery mode is decided by `email::email_mode`. A configured
//! SMTP_URL sends real mail; an explicit DEV_EMAIL=1 returns the token in the
//! response for local work; anything else REFUSES with 503.
//!
//! That default changed in 0.9.0. It used to be that an unset SMTP_URL simply
//! returned the token — a defensible contract for a friends-scale service,
//! and exactly wrong once strangers can register, because it lets anyone
//! self-verify unlimited accounts and email verification is the only sybil
//! control the marketplace has.

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

/// Deliver an account email. `Ok(Some(token))` only in explicitly enabled dev
/// mode, `Ok(None)` when a relay accepted it, and `Err` when nothing can be
/// delivered — in which case the caller MUST fail the request rather than
/// proceed, or it creates an account that can never verify.
fn deliver(state: &AppState, kind: &str, email: &str, token: &str) -> Result<Option<String>, StatusCode> {
    use crate::email::{email_mode, reset_body, send, verify_body, EmailMode};

    match email_mode(state.cfg.smtp_url.as_deref(), state.cfg.dev_email) {
        EmailMode::DevReturnToken => {
            println!("[dev-email] {kind} for {email}: token={token}");
            Ok(Some(token.to_string()))
        }
        EmailMode::Smtp => {
            let (subject, body) = if kind == "verify" {
                verify_body(&state.cfg.public_base_url, token)
            } else {
                reset_body(&state.cfg.public_base_url, token)
            };
            match send(&state.cfg, email, &subject, &body) {
                Ok(()) => Ok(None),
                Err(e) => {
                    // Loud, and a failure: silently swallowing this leaves the
                    // user staring at "check your email" forever.
                    eprintln!("[email] {kind} to {email} failed: {e}");
                    Err(StatusCode::SERVICE_UNAVAILABLE)
                }
            }
        }
        EmailMode::Refuse => {
            eprintln!(
                "[email] refusing to {kind} {email}: no SMTP_URL and DEV_EMAIL is not set. \
                 Returning the token would let anyone self-verify an account."
            );
            Err(StatusCode::SERVICE_UNAVAILABLE)
        }
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

    // The user row is already inserted above, so a delivery failure has to
    // roll it back: leaving an unverifiable account behind would also block
    // the address from ever registering again (email is UNIQUE).
    let dev_token = match deliver(&state, "verify", &email, &token) {
        Ok(t) => t,
        Err(status) => {
            let db = state.db.lock();
            let _ = db.execute("DELETE FROM tokens WHERE user_id = ?1 AND kind = 'verify'", [user_id]);
            let _ = db.execute("DELETE FROM users WHERE id = ?1", [user_id]);
            return Err(status);
        }
    };
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
    // Checked BEFORE the account lookup, deliberately. "Cannot send mail at
    // all" is a property of the server, not of this address, so failing here
    // reveals nothing. Failing AFTER the lookup would 503 for addresses that
    // exist and 200 for ones that don't — an account-enumeration oracle, and
    // this endpoint returns an identical body either way precisely to avoid
    // being one.
    if matches!(
        crate::email::email_mode(state.cfg.smtp_url.as_deref(), state.cfg.dev_email),
        crate::email::EmailMode::Refuse
    ) {
        eprintln!("[email] refusing password reset: no SMTP_URL and DEV_EMAIL is not set");
        return Err(StatusCode::SERVICE_UNAVAILABLE);
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
    // A send failure here returns 200 anyway, unlike register. Distinguishing
    // "relay hiccuped for a real address" from "no such address" would leak
    // account existence, which this endpoint is built not to do. It is logged
    // loudly instead, and the user can press the button again.
    let dev_token = deliver(&state, "reset", &email, &token).unwrap_or(None);
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
