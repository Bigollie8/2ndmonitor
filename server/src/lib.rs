//! Marketplace server for Second-Monitor Hub — library surface.
//! The binary (main.rs) is a thin wrapper; integration tests build the same
//! router against an in-memory database.

pub mod ai_review;
pub mod auth;
pub mod db;
pub mod manifest;
pub mod state;
pub mod submit;

use axum::routing::post;
use axum::{routing::get, Json, Router};
use parking_lot::Mutex;
use serde_json::json;
use state::{AppState, Config};
use std::collections::HashMap;
use std::sync::Arc;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/auth/register", post(auth::register))
        .route("/auth/verify", get(auth::verify))
        .route("/auth/login", post(auth::login))
        .route("/auth/request-reset", post(auth::request_reset))
        .route("/auth/reset", post(auth::reset))
        .route("/auth/whoami", get(auth::whoami))
        .route("/submissions", post(submit::submit))
        .route("/submissions/mine", get(submit::mine))
        .with_state(state)
}

async fn health() -> Json<serde_json::Value> {
    Json(json!({ "ok": true }))
}

pub fn build_state(cfg: Config, conn: rusqlite::Connection, seed: [u8; 32]) -> AppState {
    db::init(&conn);
    AppState {
        db: Arc::new(Mutex::new(conn)),
        cfg,
        limiter: Arc::new(Mutex::new(HashMap::new())),
        signing_seed: seed,
        review_fn: None,
    }
}

/// Test harness: in-memory DB, test config, fixed seed.
pub fn test_state() -> AppState {
    let conn = rusqlite::Connection::open_in_memory().expect("memory db");
    build_state(Config::test(), conn, [7u8; 32])
}
