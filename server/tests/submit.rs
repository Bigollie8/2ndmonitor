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

pub async fn make_user(app: &axum::Router, email: &str) -> String {
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

#[tokio::test]
async fn visualizer_lands_pending() {
    let app = router(test_state());
    let t = make_user(&app, "a@b.c").await;
    let (st, body) = call(&app, "POST", "/submissions", Some(&t), Some(serde_json::json!({
        "kind": "visualizer", "manifest": viz_manifest("my-viz", "1.0.0"),
        "code": "viz.on('frame', () => {});"
    }))).await;
    assert_eq!(st, StatusCode::OK, "{body}");
    assert_eq!(body["status"], "pending");
}

#[tokio::test]
async fn preset_auto_approves_with_sha() {
    let app = router(test_state());
    let t = make_user(&app, "a@b.c").await;
    let (st, body) = call(&app, "POST", "/submissions", Some(&t), Some(serde_json::json!({
        "kind": "preset",
        "manifest": serde_json::json!({"id":"cool-preset","name":"P","version":"1.0.0","api":1,"permissions":[]}).to_string(),
        "preset_json": "{\"baseVals\":{}}"
    }))).await;
    assert_eq!(st, StatusCode::OK, "{body}");
    assert_eq!(body["status"], "approved");
}

#[tokio::test]
async fn eval_and_oversize_and_perms_rejected() {
    let app = router(test_state());
    let t = make_user(&app, "a@b.c").await;
    let (st, _) = call(&app, "POST", "/submissions", Some(&t), Some(serde_json::json!({
        "kind": "visualizer", "manifest": viz_manifest("evil", "1.0.0"),
        "code": "eval('boom')"
    }))).await;
    assert_eq!(st, StatusCode::BAD_REQUEST);

    let big = "x".repeat(262_145);
    let (st, _) = call(&app, "POST", "/submissions", Some(&t), Some(serde_json::json!({
        "kind": "visualizer", "manifest": viz_manifest("big", "1.0.0"), "code": big
    }))).await;
    assert_eq!(st, StatusCode::BAD_REQUEST);

    let (st, _) = call(&app, "POST", "/submissions", Some(&t), Some(serde_json::json!({
        "kind": "visualizer",
        "manifest": serde_json::json!({"id":"p","name":"P","version":"1.0.0","api":1,"permissions":["net:x.y"]}).to_string(),
        "code": "ok()"
    }))).await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn duplicate_version_409_and_foreign_id_403() {
    let app = router(test_state());
    let t1 = make_user(&app, "a@b.c").await;
    let t2 = make_user(&app, "z@b.c").await;
    let sub = serde_json::json!({
        "kind": "visualizer", "manifest": viz_manifest("my-viz", "1.0.0"),
        "code": "viz.on('frame', () => {});"
    });
    let (st, _) = call(&app, "POST", "/submissions", Some(&t1), Some(sub.clone())).await;
    assert_eq!(st, StatusCode::OK);
    let (st, _) = call(&app, "POST", "/submissions", Some(&t1), Some(sub.clone())).await;
    assert_eq!(st, StatusCode::CONFLICT);
    let (st, _) = call(&app, "POST", "/submissions", Some(&t2), Some(serde_json::json!({
        "kind": "visualizer", "manifest": viz_manifest("my-viz", "2.0.0"),
        "code": "viz.on('frame', () => {});"
    }))).await;
    assert_eq!(st, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn unauthenticated_401_and_mine_lists() {
    let app = router(test_state());
    let (st, _) = call(&app, "POST", "/submissions", None, Some(serde_json::json!({
        "kind": "visualizer", "manifest": viz_manifest("x", "1.0.0"), "code": "a()"
    }))).await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);

    let t = make_user(&app, "a@b.c").await;
    call(&app, "POST", "/submissions", Some(&t), Some(serde_json::json!({
        "kind": "visualizer", "manifest": viz_manifest("mine-viz", "1.0.0"), "code": "b()"
    }))).await;
    let (st, body) = call(&app, "GET", "/submissions/mine", Some(&t), None).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(body["bundles"][0]["id"], "mine-viz");
    assert_eq!(body["bundles"][0]["status"], "pending");
}
