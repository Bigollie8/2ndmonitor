//! Cloud preset store: round-trip, overwrite, isolation between users,
//! validation, and the quota rule that re-uploading a file never fails the
//! quota it already occupies.
use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use base64::Engine;
use http_body_util::BodyExt;
use hub_marketplace::{router, test_state};
use tower::ServiceExt;

fn b64(s: &str) -> String {
    base64::engine::general_purpose::STANDARD.encode(s.as_bytes())
}

async fn call(
    app: &axum::Router,
    method: &str,
    uri: &str,
    token: Option<&str>,
    body: Option<serde_json::Value>,
) -> (StatusCode, serde_json::Value) {
    let mut req = Request::builder()
        .method(method)
        .uri(uri)
        .header("x-forwarded-for", "9.9.9.9");
    if let Some(t) = token {
        req = req.header(header::AUTHORIZATION, format!("Bearer {t}"));
    }
    let req = match body {
        Some(b) => req
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(b.to_string()))
            .unwrap(),
        None => req.body(Body::empty()).unwrap(),
    };
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let json = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
    (status, json)
}

async fn account(app: &axum::Router, email: &str) -> String {
    let (status, body) = call(
        app,
        "POST",
        "/auth/register",
        None,
        Some(serde_json::json!({ "email": email, "password": "correct horse battery" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "register failed: {body}");
    let verify = body["verify_token"].as_str().expect("dev-mode verify token").to_string();
    let (status, _) = call(app, "GET", &format!("/auth/verify?token={verify}"), None, None).await;
    assert_eq!(status, StatusCode::OK);
    let (status, body) = call(
        app,
        "POST",
        "/auth/login",
        None,
        Some(serde_json::json!({ "email": email, "password": "correct horse battery" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "login failed: {body}");
    body["token"].as_str().expect("session token").to_string()
}

#[tokio::test]
async fn round_trip_upload_list_get_delete() {
    let app = router(test_state());
    let token = account(&app, "presets@example.com").await;

    // Empty to start.
    let (status, body) = call(&app, "GET", "/account/presets", Some(&token), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["presets"].as_array().unwrap().len(), 0);

    // Upload two — one with the awkward-but-real spaces/parens name shape.
    for (file, content) in [
        ("Geiss - Reflection (remix).json", r#"{"waves":[1,2]}"#),
        ("plain.milk", "per_frame_1=wave_r = 0.5;"),
    ] {
        let (status, body) = call(
            &app,
            "POST",
            "/account/presets",
            Some(&token),
            Some(serde_json::json!({ "file": file, "content": b64(content) })),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["file"], file);
    }

    let (status, body) = call(&app, "GET", "/account/presets", Some(&token), None).await;
    assert_eq!(status, StatusCode::OK);
    let list = body["presets"].as_array().unwrap();
    assert_eq!(list.len(), 2);
    assert!(list.iter().all(|p| p["sha256"].as_str().unwrap().len() == 64));

    // Content comes back byte-identical.
    let (status, body) = call(
        &app,
        "POST",
        "/account/presets/get",
        Some(&token),
        Some(serde_json::json!({ "file": "plain.milk" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(body["content"].as_str().unwrap())
        .unwrap();
    assert_eq!(bytes, b"per_frame_1=wave_r = 0.5;");

    // Delete is effective and idempotent.
    let (status, body) = call(
        &app,
        "POST",
        "/account/presets/delete",
        Some(&token),
        Some(serde_json::json!({ "file": "plain.milk" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["deleted"], true);
    let (status, body) = call(
        &app,
        "POST",
        "/account/presets/delete",
        Some(&token),
        Some(serde_json::json!({ "file": "plain.milk" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["deleted"], false);
}

#[tokio::test]
async fn upload_overwrites_and_users_are_isolated() {
    let app = router(test_state());
    let alice = account(&app, "alice-p@example.com").await;
    let bob = account(&app, "bob-p@example.com").await;

    for (token, content) in [(&alice, "alice v1"), (&alice, "alice v2"), (&bob, "bob's")] {
        let (status, _) = call(
            &app,
            "POST",
            "/account/presets",
            Some(token),
            Some(serde_json::json!({ "file": "shared-name.json", "content": b64(content) })),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
    }

    // Alice sees her overwrite, not Bob's copy.
    let (_, body) = call(
        &app,
        "POST",
        "/account/presets/get",
        Some(&alice),
        Some(serde_json::json!({ "file": "shared-name.json" })),
    )
    .await;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(body["content"].as_str().unwrap())
        .unwrap();
    assert_eq!(bytes, b"alice v2");

    // One row each, not three.
    let (_, body) = call(&app, "GET", "/account/presets", Some(&alice), None).await;
    assert_eq!(body["presets"].as_array().unwrap().len(), 1);
    let (_, body) = call(&app, "GET", "/account/presets", Some(&bob), None).await;
    assert_eq!(body["presets"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn rejects_bad_names_bad_base64_and_anonymous_calls() {
    let app = router(test_state());
    let token = account(&app, "reject@example.com").await;

    for bad in ["../evil.json", "a/b.json", ".hidden.json", "prog.exe", ""] {
        let (status, _) = call(
            &app,
            "POST",
            "/account/presets",
            Some(&token),
            Some(serde_json::json!({ "file": bad, "content": b64("{}") })),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "accepted bad name {bad:?}");
    }

    let (status, _) = call(
        &app,
        "POST",
        "/account/presets",
        Some(&token),
        Some(serde_json::json!({ "file": "x.json", "content": "not base64!!!" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let (status, _) = call(&app, "GET", "/account/presets", None, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn oversized_upload_is_413_and_reupload_never_fails_own_quota() {
    let app = router(test_state());
    let token = account(&app, "quota@example.com").await;

    // One byte over the per-file cap.
    let big = "x".repeat(hub_marketplace::presets::FILE_CAP + 1);
    let (status, _) = call(
        &app,
        "POST",
        "/account/presets",
        Some(&token),
        Some(serde_json::json!({ "file": "big.json", "content": b64(&big) })),
    )
    .await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);

    // A file at the cap uploads, and re-uploading it (same name) succeeds —
    // the quota check excludes the row being replaced.
    let at_cap = "y".repeat(hub_marketplace::presets::FILE_CAP);
    for _ in 0..2 {
        let (status, body) = call(
            &app,
            "POST",
            "/account/presets",
            Some(&token),
            Some(serde_json::json!({ "file": "at-cap.json", "content": b64(&at_cap) })),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
    }
}
