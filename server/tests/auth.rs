use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use http_body_util::BodyExt;
use hub_marketplace::{router, test_state};
use tower::ServiceExt;

async fn post_json(
    app: &axum::Router,
    uri: &str,
    body: serde_json::Value,
) -> (StatusCode, serde_json::Value) {
    post_json_ip(app, uri, body, "1.2.3.4").await
}

async fn post_json_ip(
    app: &axum::Router,
    uri: &str,
    body: serde_json::Value,
    ip: &str,
) -> (StatusCode, serde_json::Value) {
    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(uri)
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-forwarded-for", ip)
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let v = if bytes.is_empty() {
        serde_json::json!(null)
    } else {
        serde_json::from_slice(&bytes).unwrap_or(serde_json::json!(null))
    };
    (status, v)
}

async fn get(app: &axum::Router, uri: &str) -> (StatusCode, serde_json::Value) {
    let res = app
        .clone()
        .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let v = serde_json::from_slice(&bytes).unwrap_or(serde_json::json!(null));
    (status, v)
}

#[tokio::test]
async fn register_verify_login_happy_path() {
    let app = router(test_state());
    let (st, body) = post_json(&app, "/auth/register",
        serde_json::json!({"email": "a@b.c", "password": "hunter22"})).await;
    assert_eq!(st, StatusCode::OK);
    let verify = body["verify_token"].as_str().expect("dev mode returns verify_token").to_string();

    // Login before verify → 403
    let (st, _) = post_json(&app, "/auth/login",
        serde_json::json!({"email": "a@b.c", "password": "hunter22"})).await;
    assert_eq!(st, StatusCode::FORBIDDEN);

    let (st, _) = get(&app, &format!("/auth/verify?token={verify}")).await;
    assert_eq!(st, StatusCode::OK);

    let (st, body) = post_json(&app, "/auth/login",
        serde_json::json!({"email": "a@b.c", "password": "hunter22"})).await;
    assert_eq!(st, StatusCode::OK);
    assert!(body["token"].as_str().unwrap().len() >= 32);
}

#[tokio::test]
async fn wrong_password_401_and_duplicate_email_409() {
    let app = router(test_state());
    let (_, body) = post_json(&app, "/auth/register",
        serde_json::json!({"email": "a@b.c", "password": "hunter22"})).await;
    let verify = body["verify_token"].as_str().unwrap().to_string();
    get(&app, &format!("/auth/verify?token={verify}")).await;

    let (st, _) = post_json(&app, "/auth/login",
        serde_json::json!({"email": "a@b.c", "password": "wrong-pass"})).await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);

    let (st, _) = post_json(&app, "/auth/register",
        serde_json::json!({"email": "a@b.c", "password": "whatever9"})).await;
    assert_eq!(st, StatusCode::CONFLICT);
}

#[tokio::test]
async fn short_password_rejected() {
    let app = router(test_state());
    let (st, _) = post_json(&app, "/auth/register",
        serde_json::json!({"email": "a@b.c", "password": "short"})).await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn reset_flow_rotates_password_and_kills_sessions() {
    let app = router(test_state());
    let (_, body) = post_json(&app, "/auth/register",
        serde_json::json!({"email": "a@b.c", "password": "hunter22"})).await;
    let verify = body["verify_token"].as_str().unwrap().to_string();
    get(&app, &format!("/auth/verify?token={verify}")).await;
    let (_, body) = post_json(&app, "/auth/login",
        serde_json::json!({"email": "a@b.c", "password": "hunter22"})).await;
    let old_session = body["token"].as_str().unwrap().to_string();

    let (st, body) = post_json(&app, "/auth/request-reset",
        serde_json::json!({"email": "a@b.c"})).await;
    assert_eq!(st, StatusCode::OK);
    let reset = body["reset_token"].as_str().expect("dev mode returns reset_token").to_string();

    let (st, _) = post_json(&app, "/auth/reset",
        serde_json::json!({"token": reset, "password": "new-password-9"})).await;
    assert_eq!(st, StatusCode::OK);

    // Old password dead, new works.
    let (st, _) = post_json(&app, "/auth/login",
        serde_json::json!({"email": "a@b.c", "password": "hunter22"})).await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);
    let (st, _) = post_json(&app, "/auth/login",
        serde_json::json!({"email": "a@b.c", "password": "new-password-9"})).await;
    assert_eq!(st, StatusCode::OK);

    // Old session invalidated: whoami with old token fails.
    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/auth/whoami")
                .header(header::AUTHORIZATION, format!("Bearer {old_session}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn unknown_email_reset_does_not_enumerate() {
    let app = router(test_state());
    let (st, body) = post_json(&app, "/auth/request-reset",
        serde_json::json!({"email": "ghost@nowhere.x"})).await;
    assert_eq!(st, StatusCode::OK);
    assert!(body["reset_token"].is_null());
}

#[tokio::test]
async fn rate_limit_kicks_in_at_11th_hit() {
    let app = router(test_state());
    for i in 0..10 {
        let (st, _) = post_json_ip(&app, "/auth/register",
            serde_json::json!({"email": format!("u{i}@x.y"), "password": "hunter22"}),
            "9.9.9.9").await;
        assert_eq!(st, StatusCode::OK, "hit {i} should pass");
    }
    let (st, _) = post_json_ip(&app, "/auth/register",
        serde_json::json!({"email": "u11@x.y", "password": "hunter22"}), "9.9.9.9").await;
    assert_eq!(st, StatusCode::TOO_MANY_REQUESTS);
}

// ── Phase 1: mail delivery is required before an account can exist ──────────

use hub_marketplace::build_state;
use hub_marketplace::state::Config;

/// Production-shaped config: no relay, and dev email NOT opted into.
fn refusing_state() -> hub_marketplace::state::AppState {
    let mut cfg = Config::test();
    cfg.dev_email = false;
    let conn = rusqlite::Connection::open_in_memory().expect("memory db");
    build_state(cfg, conn, [7u8; 32])
}

#[tokio::test]
async fn registration_refuses_when_no_mail_can_be_sent() {
    let app = router(refusing_state());
    let (status, body) = post_json(
        &app,
        "/auth/register",
        serde_json::json!({ "email": "a@example.com", "password": "correct horse battery" }),
    )
    .await;

    assert_eq!(
        status,
        StatusCode::SERVICE_UNAVAILABLE,
        "with no relay and no dev opt-in, registering must fail rather than hand back a token"
    );
    assert!(
        body.get("verify_token").is_none(),
        "a refused registration must never leak a token"
    );
}

// The address must stay registerable afterwards. `users.email` is UNIQUE, so
// a half-created row would lock the address out permanently with a 409.
#[tokio::test]
async fn a_refused_registration_leaves_no_row_behind() {
    let state = refusing_state();
    let app = router(state.clone());
    let (status, _) = post_json(
        &app,
        "/auth/register",
        serde_json::json!({ "email": "rollback@example.com", "password": "correct horse battery" }),
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);

    let count: i64 = state
        .db
        .lock()
        .query_row(
            "SELECT COUNT(*) FROM users WHERE email = ?1",
            ["rollback@example.com"],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 0, "the user row must be rolled back, or the address is locked out for good");
}

#[tokio::test]
async fn dev_mode_still_returns_the_token_when_asked_for() {
    let app = router(test_state());
    let (status, body) = post_json(
        &app,
        "/auth/register",
        serde_json::json!({ "email": "b@example.com", "password": "correct horse battery" }),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert!(
        body.get("verify_token").is_some(),
        "Config::test() opts into dev email explicitly"
    );
}

// Checked before the account lookup so it cannot become an enumeration
// oracle: the same 503 for an address that exists and one that does not.
#[tokio::test]
async fn password_reset_refuses_identically_for_known_and_unknown_addresses() {
    let app = router(refusing_state());
    let (known, _) = post_json(
        &app,
        "/auth/request-reset",
        serde_json::json!({ "email": "b@example.com" }),
    )
    .await;
    let (unknown, _) = post_json(
        &app,
        "/auth/request-reset",
        serde_json::json!({ "email": "nobody@example.com" }),
    )
    .await;
    assert_eq!(known, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(unknown, known, "differing status would leak whether an account exists");
}
