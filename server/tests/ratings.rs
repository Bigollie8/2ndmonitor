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
    let v = if bytes.is_empty() {
        serde_json::json!(null)
    } else {
        serde_json::from_slice(&bytes).unwrap_or(serde_json::json!(null))
    };
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

/// Publishes an approved preset under `id` (presets auto-approve), authored
/// by a fresh user so the caller's own token is free to use for rating.
async fn make_approved_bundle(app: &axum::Router, id: &str) {
    let t = make_user(app, &format!("{id}-author@x.y")).await;
    let (st, body) = call(app, "POST", "/submissions", Some(&t), Some(serde_json::json!({
        "kind": "preset",
        "manifest": serde_json::json!({"id": id, "name": "P", "version": "1.0.0", "api": 1, "permissions": []}).to_string(),
        "preset_json": "{\"baseVals\":{}}"
    }))).await;
    assert_eq!(st, StatusCode::OK, "{body}");
    assert_eq!(body["status"], "approved");
}

#[tokio::test]
async fn rating_without_auth_is_401() {
    let app = router(test_state());
    make_approved_bundle(&app, "bundle-a").await;
    let (st, _) = call(&app, "POST", "/ratings", None, Some(serde_json::json!({
        "id": "bundle-a", "stars": 5
    }))).await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn stars_out_of_range_or_wrong_type_are_rejected() {
    let app = router(test_state());
    make_approved_bundle(&app, "bundle-b").await;
    let t = make_user(&app, "rater@x.y").await;

    for bad in [serde_json::json!(0), serde_json::json!(6), serde_json::json!(3.5), serde_json::json!("5")] {
        let (st, body) = call(&app, "POST", "/ratings", Some(&t), Some(serde_json::json!({
            "id": "bundle-b", "stars": bad
        }))).await;
        assert_eq!(st, StatusCode::BAD_REQUEST, "stars={bad} body={body}");
    }
}

#[tokio::test]
async fn re_rating_replaces_rather_than_stacks() {
    let app = router(test_state());
    make_approved_bundle(&app, "bundle-c").await;
    let t = make_user(&app, "rater@x.y").await;

    let (st, _) = call(&app, "POST", "/ratings", Some(&t), Some(serde_json::json!({
        "id": "bundle-c", "stars": 5
    }))).await;
    assert_eq!(st, StatusCode::OK);
    let (st, _) = call(&app, "POST", "/ratings", Some(&t), Some(serde_json::json!({
        "id": "bundle-c", "stars": 3
    }))).await;
    assert_eq!(st, StatusCode::OK);

    let (st, body) = call(&app, "GET", "/ratings", None, None).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(body["bundle-c"]["count"], 1);
    assert_eq!(body["bundle-c"]["avg"], 3.0);
}

#[tokio::test]
async fn rating_unapproved_or_nonexistent_bundle_is_rejected() {
    let app = router(test_state());
    let author = make_user(&app, "author@x.y").await;
    let (st, body) = call(&app, "POST", "/submissions", Some(&author), Some(serde_json::json!({
        "kind": "visualizer",
        "manifest": serde_json::json!({"id":"pending-viz","name":"V","version":"1.0.0","api":1,"permissions":[]}).to_string(),
        "code": "viz.on('frame', () => {});"
    }))).await;
    assert_eq!(st, StatusCode::OK, "{body}");
    assert_eq!(body["status"], "pending");

    let t = make_user(&app, "rater@x.y").await;

    let (st, _) = call(&app, "POST", "/ratings", Some(&t), Some(serde_json::json!({
        "id": "pending-viz", "stars": 4
    }))).await;
    assert_eq!(st, StatusCode::BAD_REQUEST, "unapproved bundle must be rejected");

    let (st, _) = call(&app, "POST", "/ratings", Some(&t), Some(serde_json::json!({
        "id": "does-not-exist", "stars": 4
    }))).await;
    assert_eq!(st, StatusCode::BAD_REQUEST, "nonexistent bundle must be rejected");
}

#[tokio::test]
async fn aggregate_is_correct_across_multiple_users_and_endpoint_is_public() {
    let app = router(test_state());
    make_approved_bundle(&app, "bundle-d").await;

    let t1 = make_user(&app, "u1@x.y").await;
    let t2 = make_user(&app, "u2@x.y").await;
    let t3 = make_user(&app, "u3@x.y").await;

    for (t, stars) in [(&t1, 5), (&t2, 4), (&t3, 3)] {
        let (st, _) = call(&app, "POST", "/ratings", Some(t), Some(serde_json::json!({
            "id": "bundle-d", "stars": stars
        }))).await;
        assert_eq!(st, StatusCode::OK);
    }

    // No Authorization header at all — GET /ratings must be public.
    let (st, body) = call(&app, "GET", "/ratings", None, None).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(body["bundle-d"]["count"], 3);
    // (5+4+3)/3 = 4.0
    assert_eq!(body["bundle-d"]["avg"], 4.0);

    // A bundle nobody rated is simply absent, not present with count 0.
    assert!(body.get("bundle-d-ghost").is_none());
}

#[tokio::test]
async fn average_rounds_to_one_decimal() {
    let app = router(test_state());
    make_approved_bundle(&app, "bundle-e").await;
    let t1 = make_user(&app, "v1@x.y").await;
    let t2 = make_user(&app, "v2@x.y").await;
    let t3 = make_user(&app, "v3@x.y").await;

    // (5+5+4)/3 = 4.666... -> rounds to 4.7
    for (t, stars) in [(&t1, 5), (&t2, 5), (&t3, 4)] {
        call(&app, "POST", "/ratings", Some(t), Some(serde_json::json!({
            "id": "bundle-e", "stars": stars
        }))).await;
    }

    let (st, body) = call(&app, "GET", "/ratings", None, None).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(body["bundle-e"]["avg"], 4.7);
}
