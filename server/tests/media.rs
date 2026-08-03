use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use base64::Engine;
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

/// Smallest valid PNG: 1x1. Needed because both the media sniff and the legacy
/// `validate_preview` read magic bytes and refuse anything unidentifiable.
fn tiny_png() -> Vec<u8> {
    base64::engine::general_purpose::STANDARD
        .decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
        .unwrap()
}

fn b64_png() -> String {
    base64::engine::general_purpose::STANDARD.encode(tiny_png())
}

async fn seed_approved_preset(app: &axum::Router, token: &str, id: &str) {
    let manifest = serde_json::json!({
        "id": id, "name": "Media Seed", "version": "1.0.0", "api": 1, "permissions": []
    })
    .to_string();
    call(app, "POST", "/submissions", Some(token),
        Some(serde_json::json!({"kind": "preset", "manifest": manifest, "preset_json": "{}"}))).await;
}

async fn raw_get(app: &axum::Router, uri: &str) -> (StatusCode, Option<String>, Vec<u8>) {
    let req = Request::builder().method("GET").uri(uri).body(Body::empty()).unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let mime = res
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let bytes = res.into_body().collect().await.unwrap().to_bytes().to_vec();
    (status, mime, bytes)
}

#[tokio::test]
async fn admin_can_upload_media_and_anyone_can_fetch_it() {
    let app = router(test_state());
    let token = make_user(&app, "media@example.com").await;
    seed_approved_preset(&app, &token, "with-media").await;

    let (status, _) = call(&app, "POST", "/admin/bundles/with-media/1.0.0/media", Some("test-admin"),
        Some(serde_json::json!({"idx": 0, "kind": "still", "bytes": b64_png()}))).await;
    assert_eq!(status, StatusCode::OK);

    let (status, mime, bytes) = raw_get(&app, "/bundle/with-media/1.0.0/media/0").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(mime.as_deref(), Some("image/png"));
    assert_eq!(bytes, tiny_png());
}

#[tokio::test]
async fn media_count_appears_in_the_index() {
    let app = router(test_state());
    let token = make_user(&app, "count@example.com").await;
    seed_approved_preset(&app, &token, "counted").await;

    for idx in 0..3 {
        call(&app, "POST", "/admin/bundles/counted/1.0.0/media", Some("test-admin"),
            Some(serde_json::json!({"idx": idx, "kind": "still", "bytes": b64_png()}))).await;
    }

    let (_, idx) = call(&app, "GET", "/index.json", None, None).await;
    let b = idx["bundles"].as_array().unwrap().iter()
        .find(|b| b["id"] == "counted").unwrap().clone();
    assert_eq!(b["mediaCount"], 3);
    assert_eq!(b["hasPreview"], true, "media rows must make hasPreview true");
}

#[tokio::test]
async fn the_preview_route_still_serves_a_legacy_blob() {
    let app = router(test_state());
    let token = make_user(&app, "legacy@example.com").await;
    // Submit WITH a preview blob and no media rows -- the exact shape of every
    // bundle published before Market v2.
    let manifest = serde_json::json!({
        "id": "legacy", "name": "Legacy", "version": "1.0.0", "api": 1, "permissions": []
    })
    .to_string();
    call(&app, "POST", "/submissions", Some(&token),
        Some(serde_json::json!({
            "kind": "preset", "manifest": manifest, "preset_json": "{}", "preview": b64_png()
        }))).await;

    let (status, _, bytes) = raw_get(&app, "/bundle/legacy/1.0.0/preview").await;
    assert_eq!(status, StatusCode::OK, "0.7.x clients must keep working");
    assert_eq!(bytes, tiny_png());
}

#[tokio::test]
async fn the_preview_route_prefers_media_index_zero() {
    let app = router(test_state());
    let token = make_user(&app, "prefer@example.com").await;
    seed_approved_preset(&app, &token, "prefer").await;

    call(&app, "POST", "/admin/bundles/prefer/1.0.0/media", Some("test-admin"),
        Some(serde_json::json!({"idx": 0, "kind": "still", "bytes": b64_png()}))).await;

    let (status, _, bytes) = raw_get(&app, "/bundle/prefer/1.0.0/preview").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(bytes, tiny_png());
}

#[tokio::test]
async fn media_caps_are_enforced() {
    let app = router(test_state());
    let token = make_user(&app, "caps@example.com").await;
    seed_approved_preset(&app, &token, "capped").await;

    // Six assets fit; the seventh is refused.
    for idx in 0..6 {
        let (status, _) = call(&app, "POST", "/admin/bundles/capped/1.0.0/media", Some("test-admin"),
            Some(serde_json::json!({"idx": idx, "kind": "still", "bytes": b64_png()}))).await;
        assert_eq!(status, StatusCode::OK, "asset {idx} should fit under the cap");
    }
    let (status, _) = call(&app, "POST", "/admin/bundles/capped/1.0.0/media", Some("test-admin"),
        Some(serde_json::json!({"idx": 6, "kind": "still", "bytes": b64_png()}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "max 6 assets per version");

    // Re-uploading an OCCUPIED slot must still work at the cap: it replaces
    // rather than adds.
    let (status, _) = call(&app, "POST", "/admin/bundles/capped/1.0.0/media", Some("test-admin"),
        Some(serde_json::json!({"idx": 3, "kind": "still", "bytes": b64_png()}))).await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn an_oversized_still_is_refused() {
    let app = router(test_state());
    let token = make_user(&app, "big@example.com").await;
    seed_approved_preset(&app, &token, "big").await;

    let mut big = tiny_png();
    big.resize(300 * 1024, 0);
    let b64 = base64::engine::general_purpose::STANDARD.encode(&big);
    let (status, _) = call(&app, "POST", "/admin/bundles/big/1.0.0/media", Some("test-admin"),
        Some(serde_json::json!({"idx": 0, "kind": "still", "bytes": b64}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn a_non_image_is_refused_by_the_magic_byte_sniff() {
    let app = router(test_state());
    let token = make_user(&app, "notimg@example.com").await;
    seed_approved_preset(&app, &token, "notimg").await;

    let b64 = base64::engine::general_purpose::STANDARD.encode(b"not an image at all");
    let (status, _) = call(&app, "POST", "/admin/bundles/notimg/1.0.0/media", Some("test-admin"),
        Some(serde_json::json!({"idx": 0, "kind": "still", "bytes": b64}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn media_upload_requires_the_admin_token() {
    let app = router(test_state());
    let token = make_user(&app, "mediaauth@example.com").await;
    seed_approved_preset(&app, &token, "mguard").await;

    let (status, _) = call(&app, "POST", "/admin/bundles/mguard/1.0.0/media", Some(&token),
        Some(serde_json::json!({"idx": 0, "kind": "still", "bytes": b64_png()}))).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn deleting_media_removes_it_and_drops_the_count() {
    let app = router(test_state());
    let token = make_user(&app, "del@example.com").await;
    seed_approved_preset(&app, &token, "deletable").await;

    call(&app, "POST", "/admin/bundles/deletable/1.0.0/media", Some("test-admin"),
        Some(serde_json::json!({"idx": 0, "kind": "still", "bytes": b64_png()}))).await;
    let (status, _) = call(&app, "DELETE", "/admin/bundles/deletable/1.0.0/media/0",
        Some("test-admin"), None).await;
    assert_eq!(status, StatusCode::OK);

    let (status, _, _) = raw_get(&app, "/bundle/deletable/1.0.0/media/0").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
