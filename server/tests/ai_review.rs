use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use http_body_util::BodyExt;
use hub_marketplace::{router, test_state, test_state_with_reviewer};
use std::sync::Arc;
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

async fn make_user_and_submit(app: &axum::Router) {
    let (_, body) = call(app, "POST", "/auth/register", None,
        Some(serde_json::json!({"email": "a@b.c", "password": "hunter22"}))).await;
    let verify = body["verify_token"].as_str().unwrap().to_string();
    call(app, "GET", &format!("/auth/verify?token={verify}"), None, None).await;
    let (_, body) = call(app, "POST", "/auth/login", None,
        Some(serde_json::json!({"email": "a@b.c", "password": "hunter22"}))).await;
    let t = body["token"].as_str().unwrap().to_string();
    let (st, b) = call(app, "POST", "/submissions", Some(&t), Some(serde_json::json!({
        "kind": "visualizer",
        "manifest": serde_json::json!({"id":"my-viz","name":"V","version":"1.0.0","api":1,"permissions":[]}).to_string(),
        "code": "viz.on('frame', () => {});"
    }))).await;
    assert_eq!(st, StatusCode::OK, "{b}");
}

#[tokio::test]
async fn no_reviewer_configured_leaves_report_null() {
    let app = router(test_state()); // Config::test() has no ANTHROPIC_API_KEY
    make_user_and_submit(&app).await;
    let (st, body) = call(&app, "GET", "/admin/queue", Some("test-admin"), None).await;
    assert_eq!(st, StatusCode::OK);
    assert!(body["pending"][0]["ai_report"].is_null());
}

#[tokio::test]
async fn injected_reviewer_report_lands_in_queue() {
    let state = test_state_with_reviewer(Arc::new(|manifest, code, prev| {
        assert!(manifest.contains("my-viz"));
        assert!(code.contains("viz.on"));
        assert!(prev.is_none());
        Some(r#"{"verdict":"looks_ok","notes":"clean spectrum bars"}"#.to_string())
    }));
    let app = router(state);
    make_user_and_submit(&app).await;
    let (_, body) = call(&app, "GET", "/admin/queue", Some("test-admin"), None).await;
    assert_eq!(body["pending"][0]["ai_report"]["verdict"], "looks_ok");
    assert_eq!(body["pending"][0]["ai_report"]["notes"], "clean spectrum bars");
}
