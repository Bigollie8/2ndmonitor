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

fn tile_manifest(id: &str, version: &str) -> String {
    serde_json::json!({
        "id": id, "name": "T", "version": version, "api": 1,
        "permissions": []
    }).to_string()
}

fn tile_view() -> &'static str {
    r#"{"source":{"kind":"http","url":"https://api.example.com/x","intervalMs":60000},"view":{"type":"stat","value":"{{data.n}}"}}"#
}

/// Fetches raw response bytes (unlike `call`, which JSON-decodes — a zip body
/// isn't JSON).
async fn get_bytes(app: &axum::Router, uri: &str) -> (StatusCode, Vec<u8>) {
    let req = Request::builder()
        .method("GET")
        .uri(uri)
        .header("x-forwarded-for", "1.1.1.1")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes().to_vec();
    (status, bytes)
}

/// C1 regression: the server used to zip a tile's view.json under the name
/// "main.js", which `marketplace_install`'s "tile" arm (app/src-tauri/src/
/// marketplace.rs) rejects outright since it requires "view.json" — every
/// published tile failed to install. Assert the payload is stored/zipped
/// under "view.json", not "main.js".
#[tokio::test]
async fn tile_submission_is_stored_and_zipped_as_view_json() {
    let app = router(test_state());
    let t = make_user(&app, "a@b.c").await;
    let (st, body) = call(&app, "POST", "/submissions", Some(&t), Some(serde_json::json!({
        "kind": "tile", "manifest": tile_manifest("my-tile", "1.0.0"), "code": tile_view()
    }))).await;
    assert_eq!(st, StatusCode::OK, "{body}");
    assert_eq!(body["status"], "pending");

    // Approve it so a zip gets built, then download and inspect entry names.
    let (st, _) = call(&app, "POST", "/admin/decide", Some("test-admin"), Some(serde_json::json!({
        "id": "my-tile", "version": "1.0.0", "approve": true
    }))).await;
    assert_eq!(st, StatusCode::OK);

    let (st, zip_bytes) = get_bytes(&app, "/bundle/my-tile/1.0.0").await;
    assert_eq!(st, StatusCode::OK);

    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(zip_bytes)).unwrap();
    let mut names: Vec<String> = (0..archive.len())
        .map(|i| archive.by_index(i).unwrap().name().to_string())
        .collect();
    names.sort();
    assert_eq!(names, vec!["manifest.json".to_string(), "view.json".to_string()]);
}

/// End-to-end proof that the /submissions wiring (not just the unit-level
/// validate_preview) actually decodes, validates, and persists a preview,
/// and that a non-image is rejected at the HTTP boundary rather than
/// silently stored.
#[tokio::test]
async fn preview_round_trips_through_the_real_endpoint_and_bad_ones_are_rejected() {
    use base64::Engine;
    let state = hub_marketplace::test_state();
    let app = router(state.clone());
    let t = make_user(&app, "a@b.c").await;

    let png = [vec![0x89u8, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A], vec![0u8; 16]].concat();
    let preview_b64 = base64::engine::general_purpose::STANDARD.encode(&png);

    let (st, body) = call(&app, "POST", "/submissions", Some(&t), Some(serde_json::json!({
        "kind": "preset",
        "manifest": serde_json::json!({"id":"has-preview","name":"P","version":"1.0.0","api":1,"permissions":[]}).to_string(),
        "preset_json": "{\"baseVals\":{}}",
        "preview": preview_b64,
    }))).await;
    assert_eq!(st, StatusCode::OK, "{body}");

    let stored: Vec<u8> = state
        .db
        .lock()
        .query_row("SELECT preview FROM bundles WHERE id = 'has-preview'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(stored, png);

    // Fails the magic-number sniff -> rejected before it ever reaches storage.
    let bogus_b64 = base64::engine::general_purpose::STANDARD.encode(b"<html>not an image");
    let (st, _) = call(&app, "POST", "/submissions", Some(&t), Some(serde_json::json!({
        "kind": "preset",
        "manifest": serde_json::json!({"id":"bad-preview","name":"P","version":"1.0.0","api":1,"permissions":[]}).to_string(),
        "preset_json": "{\"baseVals\":{}}",
        "preview": bogus_b64,
    }))).await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
    let count: i64 = state
        .db
        .lock()
        .query_row("SELECT COUNT(*) FROM bundles WHERE id = 'bad-preview'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 0, "a rejected preview must not leave a row behind");

    // No preview at all stays a valid submission.
    let (st, body) = call(&app, "POST", "/submissions", Some(&t), Some(serde_json::json!({
        "kind": "preset",
        "manifest": serde_json::json!({"id":"no-preview","name":"P","version":"1.0.0","api":1,"permissions":[]}).to_string(),
        "preset_json": "{\"baseVals\":{}}",
    }))).await;
    assert_eq!(st, StatusCode::OK, "{body}");
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
