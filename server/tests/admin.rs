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

fn viz_manifest(id: &str, version: &str) -> String {
    serde_json::json!({"id": id, "name": "V", "version": version, "api": 1, "permissions": []}).to_string()
}

async fn submit_viz(app: &axum::Router, t: &str, id: &str, version: &str, code: &str) {
    let (st, b) = call(app, "POST", "/submissions", Some(t), Some(serde_json::json!({
        "kind": "visualizer", "manifest": viz_manifest(id, version), "code": code
    }))).await;
    assert_eq!(st, StatusCode::OK, "{b}");
}

#[tokio::test]
async fn queue_shows_pending_with_diff_base_and_decide_flows() {
    let app = router(test_state());
    let t = make_user(&app, "a@b.c").await;
    submit_viz(&app, &t, "my-viz", "1.0.0", "v1()").await;

    // Approve v1.
    let (st, body) = call(&app, "GET", "/admin/queue", Some("test-admin"), None).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(body["pending"][0]["id"], "my-viz");
    assert!(body["pending"][0]["diff_base"].is_null());
    let (st, _) = call(&app, "POST", "/admin/decide", Some("test-admin"), Some(serde_json::json!({
        "id": "my-viz", "version": "1.0.0", "approve": true
    }))).await;
    assert_eq!(st, StatusCode::OK);

    // v2 shows v1 as diff base.
    submit_viz(&app, &t, "my-viz", "2.0.0", "v2()").await;
    let (_, body) = call(&app, "GET", "/admin/queue", Some("test-admin"), None).await;
    assert_eq!(body["pending"][0]["version"], "2.0.0");
    assert_eq!(body["pending"][0]["diff_base"], "v1()");

    // Reject v2 with a note; author sees it.
    let (st, _) = call(&app, "POST", "/admin/decide", Some("test-admin"), Some(serde_json::json!({
        "id": "my-viz", "version": "2.0.0", "approve": false, "note": "too spooky"
    }))).await;
    assert_eq!(st, StatusCode::OK);
    let (_, body) = call(&app, "GET", "/submissions/mine", Some(&t), None).await;
    let v2 = body["bundles"].as_array().unwrap().iter()
        .find(|b| b["version"] == "2.0.0").unwrap();
    assert_eq!(v2["status"], "rejected");
    assert_eq!(v2["review_note"], "too spooky");

    // Double-decide → 409.
    let (st, _) = call(&app, "POST", "/admin/decide", Some("test-admin"), Some(serde_json::json!({
        "id": "my-viz", "version": "2.0.0", "approve": true
    }))).await;
    assert_eq!(st, StatusCode::CONFLICT);
}

#[tokio::test]
async fn admin_endpoints_forbid_bad_tokens() {
    let app = router(test_state());
    let (st, _) = call(&app, "GET", "/admin/queue", None, None).await;
    assert_eq!(st, StatusCode::FORBIDDEN);
    let (st, _) = call(&app, "GET", "/admin/queue", Some("wrong"), None).await;
    assert_eq!(st, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn admin_page_serves_html() {
    let app = router(test_state());
    let res = app
        .oneshot(Request::builder().uri("/admin").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body = res.into_body().collect().await.unwrap().to_bytes();
    assert!(String::from_utf8_lossy(&body).contains("Review queue"));
}
