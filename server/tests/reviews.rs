use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use http_body_util::BodyExt;
use hub_marketplace::{router, test_state};
use tower::ServiceExt;

async fn call(
    app: &axum::Router,
    method: &str,
    uri: &str,
    token: Option<&str>,
    body: Option<serde_json::Value>,
) -> (StatusCode, serde_json::Value) {
    let mut req = Request::builder().method(method).uri(uri);
    if let Some(t) = token {
        req = req.header(header::AUTHORIZATION, format!("Bearer {t}"));
    }
    let req = if let Some(b) = body {
        req.header(header::CONTENT_TYPE, "application/json")
            .header("x-forwarded-for", "1.1.1.1")
            .body(Body::from(b.to_string()))
            .unwrap()
    } else {
        req.header("x-forwarded-for", "1.1.1.1").body(Body::empty()).unwrap()
    };
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let v = serde_json::from_slice(&bytes).unwrap_or(serde_json::json!(null));
    (status, v)
}

async fn make_user(app: &axum::Router, email: &str) -> String {
    let (_, body) = call(app, "POST", "/auth/register", None,
        Some(serde_json::json!({"email": email, "password": "hunter22"}))).await;
    let verify = body["verify_token"].as_str().unwrap().to_string();
    call(app, "GET", &format!("/auth/verify?token={verify}"), None, None).await;
    let (_, body) = call(app, "POST", "/auth/login", None,
        Some(serde_json::json!({"email": email, "password": "hunter22"}))).await;
    body["token"].as_str().unwrap().to_string()
}

async fn seed_approved_preset(app: &axum::Router, token: &str, id: &str) {
    let manifest = serde_json::json!({
        "id": id, "name": "Reviewed", "version": "1.0.0", "api": 1, "permissions": []
    })
    .to_string();
    call(app, "POST", "/submissions", Some(token),
        Some(serde_json::json!({"kind": "preset", "manifest": manifest, "preset_json": "{}"}))).await;
}

#[tokio::test]
async fn a_signed_in_user_can_post_and_read_a_review() {
    let app = router(test_state());
    let token = make_user(&app, "rev@example.com").await;
    seed_approved_preset(&app, &token, "reviewed").await;

    let (status, _) = call(&app, "POST", "/reviews", Some(&token),
        Some(serde_json::json!({"id": "reviewed", "body": "Works great."}))).await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = call(&app, "GET", "/reviews?id=reviewed", None, None).await;
    assert_eq!(status, StatusCode::OK);
    let r = &body["reviews"][0];
    assert_eq!(r["body"], "Works great.");
    assert_eq!(r["author"], "rev***", "authors are masked, same as the index");
    assert!(r["createdAt"].as_i64().unwrap_or(0) > 0);
}

#[tokio::test]
async fn posting_a_review_requires_sign_in() {
    let app = router(test_state());
    let token = make_user(&app, "anon@example.com").await;
    seed_approved_preset(&app, &token, "anon-target").await;

    let (status, _) = call(&app, "POST", "/reviews", None,
        Some(serde_json::json!({"id": "anon-target", "body": "drive-by"}))).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn re_reviewing_replaces_rather_than_stacks() {
    let app = router(test_state());
    let token = make_user(&app, "again@example.com").await;
    seed_approved_preset(&app, &token, "again").await;

    call(&app, "POST", "/reviews", Some(&token),
        Some(serde_json::json!({"id": "again", "body": "first take"}))).await;
    call(&app, "POST", "/reviews", Some(&token),
        Some(serde_json::json!({"id": "again", "body": "second take"}))).await;

    let (_, body) = call(&app, "GET", "/reviews?id=again", None, None).await;
    assert_eq!(body["reviews"].as_array().unwrap().len(), 1);
    assert_eq!(body["reviews"][0]["body"], "second take");
}

#[tokio::test]
async fn a_review_of_an_unknown_bundle_is_refused() {
    let app = router(test_state());
    let token = make_user(&app, "ghost@example.com").await;
    let (status, _) = call(&app, "POST", "/reviews", Some(&token),
        Some(serde_json::json!({"id": "does-not-exist", "body": "hello"}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn a_review_body_is_capped_and_must_not_be_blank() {
    let app = router(test_state());
    let token = make_user(&app, "cap@example.com").await;
    seed_approved_preset(&app, &token, "capped-review").await;

    let (status, _) = call(&app, "POST", "/reviews", Some(&token),
        Some(serde_json::json!({"id": "capped-review", "body": "x".repeat(1001)}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let (status, _) = call(&app, "POST", "/reviews", Some(&token),
        Some(serde_json::json!({"id": "capped-review", "body": "   "}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn a_hidden_review_disappears_from_the_public_list() {
    let app = router(test_state());
    let token = make_user(&app, "hide@example.com").await;
    seed_approved_preset(&app, &token, "hideable").await;
    call(&app, "POST", "/reviews", Some(&token),
        Some(serde_json::json!({"id": "hideable", "body": "abusive"}))).await;

    let (_, body) = call(&app, "GET", "/reviews?id=hideable", None, None).await;
    assert_eq!(body["reviews"].as_array().unwrap().len(), 1);

    // user_id 1 is the only registered user in this test.
    let (status, _) = call(&app, "POST", "/admin/reviews/hideable/1/hide", Some("test-admin"), None).await;
    assert_eq!(status, StatusCode::OK);

    let (_, body) = call(&app, "GET", "/reviews?id=hideable", None, None).await;
    assert_eq!(body["reviews"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn hiding_a_review_requires_the_admin_token() {
    let app = router(test_state());
    let token = make_user(&app, "hideauth@example.com").await;
    let (status, _) = call(&app, "POST", "/admin/reviews/x/1/hide", Some(&token), None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn a_review_carries_the_same_user_s_star_rating_when_there_is_one() {
    let app = router(test_state());
    let token = make_user(&app, "starred@example.com").await;
    seed_approved_preset(&app, &token, "starred").await;

    call(&app, "POST", "/ratings", Some(&token),
        Some(serde_json::json!({"id": "starred", "stars": 4}))).await;
    call(&app, "POST", "/reviews", Some(&token),
        Some(serde_json::json!({"id": "starred", "body": "Solid."}))).await;

    let (_, body) = call(&app, "GET", "/reviews?id=starred", None, None).await;
    assert_eq!(body["reviews"][0]["stars"], 4);
}
