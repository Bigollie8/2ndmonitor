//! Marketplace server for Second-Monitor Hub — library surface.
//! The binary (main.rs) is a thin wrapper; integration tests build the same
//! router against an in-memory database.

pub mod admin;
pub mod ai_review;
pub mod auth;
pub mod collections;
pub mod db;
pub mod email;
pub mod handle;
pub mod index;
pub mod profiles;
pub mod comments;
pub mod moderation;
pub mod avatar;
pub mod directory;
pub mod forum;
pub mod shouts;
pub mod roles;
pub mod social;
pub mod staff;
pub mod keys;
pub mod manifest;
pub mod media;
pub mod ratings;
pub mod reviews;
pub mod state;
pub mod submit;

use axum::routing::{delete, patch, post};
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
        .route("/account", get(profiles::get_account).patch(profiles::patch_account))
        .route("/account/handle", post(profiles::claim_handle))
        .route("/creators/:handle", get(profiles::get_creator))
        .route("/creators", get(directory::list))
        .route("/account/avatar", post(avatar::put_avatar))
        .route("/creators/:handle/avatar", get(avatar::get_avatar))
        .route("/topics", get(forum::list_topics).post(forum::create_topic))
        .route("/topics/replies", get(forum::list_replies).post(forum::create_reply))
        .route("/shouts", get(shouts::list).post(shouts::post))
        .route("/follows", post(social::set_follow).get(social::follow_status))
        .route("/follows/mine", get(social::follows_mine))
        .route("/favourites", post(social::set_favourite).get(social::favourites))
        .route("/feed", get(social::feed))
        .route("/comments", get(comments::list).post(comments::post))
        .route("/blocks", post(comments::set_block))
        .route("/reports", post(comments::report))
        .route("/admin/users", get(staff::users))
        .route("/admin/whoami", get(staff::whoami))
        .route("/admin/reports", get(moderation::queue))
        .route("/admin/moderate", post(moderation::act))
        .route("/admin/audit", get(moderation::audit))
        .route("/admin/undo", post(moderation::undo))
        .route("/submissions", post(submit::submit))
        .route("/submissions/mine", get(submit::mine))
        .route("/ratings", post(ratings::rate).get(ratings::ratings))
        .route("/admin", get(admin::page))
        .route("/admin/queue", get(admin::queue))
        .route("/admin/decide", post(admin::decide))
        .route("/admin/bundles/:id/:version", patch(admin::patch_bundle))
        .route("/index.json", get(index::index_json))
        .route("/bundle/:id/:version", get(index::download))
        .route("/bundle/:id/:version/preview", get(index::preview))
        .route("/bundle/:id/:version/media/:idx", get(media::get_media))
        .route("/admin/bundles/:id/:version/media", post(media::put_media))
        .route("/admin/bundles/:id/:version/media/:idx", delete(media::delete_media))
        .route("/collections", get(collections::list))
        .route("/admin/collections", post(collections::upsert))
        .route("/admin/collections/:slug", delete(collections::remove))
        .route("/reviews", get(reviews::list).post(reviews::post))
        .route("/admin/reviews/:bundle_id/:user_id/hide", post(reviews::hide))
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

/// Test harness with an injected AI reviewer (runs synchronously in kick()).
pub fn test_state_with_reviewer(review_fn: state::ReviewFn) -> AppState {
    let mut s = test_state();
    s.review_fn = Some(review_fn);
    s
}
