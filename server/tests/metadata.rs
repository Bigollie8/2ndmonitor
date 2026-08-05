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
    let token = body["token"].as_str().unwrap().to_string();
    // 0.9.0: publishing requires a claimed handle. Derived from the address so
    // every test account gets a distinct, valid one without each test caring.
    // From the WHOLE address, not just the local part: "a@b.c" has a
    // one-character local part, and handles have a three-character minimum.
    let slug: String = email.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    let handle: String = format!("u{slug}").chars().take(24).collect();
    call(app, "POST", "/account/handle", Some(&token),
        Some(serde_json::json!({ "handle": handle }))).await;
    token
}

fn preset_manifest_with_meta(id: &str) -> String {
    serde_json::json!({
        "id": id, "name": "Metadata Preset", "version": "1.0.0", "api": 1, "permissions": [],
        "summary": "A preset with real metadata",
        "description": "Longer prose.",
        "category": "milkdrop",
        "tags": ["neon", "fast"],
        "icon": "◆",
        "changelog": "Initial release.",
        "minAppVersion": "0.8.0"
    })
    .to_string()
}

async fn seed_preset(app: &axum::Router, token: &str, id: &str) {
    let manifest = serde_json::json!({
        "id": id, "name": "Seed", "version": "1.0.0", "api": 1, "permissions": []
    })
    .to_string();
    call(app, "POST", "/submissions", Some(token),
        Some(serde_json::json!({"kind": "preset", "manifest": manifest, "preset_json": "{}"}))).await;
}

async fn index_row(app: &axum::Router, id: &str) -> serde_json::Value {
    let (_, idx) = call(app, "GET", "/index.json", None, None).await;
    idx["bundles"].as_array().unwrap().iter()
        .find(|b| b["id"] == id)
        .cloned()
        .expect("bundle must be in the index")
}

/// Presets auto-approve at submit time, so this is the one kind whose
/// `approved_at` must be stamped by `submit` rather than by admin `decide`.
#[tokio::test]
async fn preset_submission_persists_metadata_and_is_approved_immediately() {
    let app = router(test_state());
    let token = make_user(&app, "meta@example.com").await;

    let (status, _) = call(&app, "POST", "/submissions", Some(&token),
        Some(serde_json::json!({
            "kind": "preset",
            "manifest": preset_manifest_with_meta("meta-preset"),
            "preset_json": "{\"a\":1}"
        }))).await;
    assert_eq!(status, StatusCode::OK);

    let b = index_row(&app, "meta-preset").await;
    assert_eq!(b["summary"], "A preset with real metadata");
    assert_eq!(b["category"], "milkdrop");
    assert_eq!(b["tags"], serde_json::json!(["neon", "fast"]));
    assert_eq!(b["icon"], "◆");
    assert_eq!(b["changelog"], "Initial release.");
    assert_eq!(b["minAppVersion"], "0.8.0");
    assert!(b["approvedAt"].as_i64().unwrap_or(0) > 0, "approvedAt must be stamped");
}

#[tokio::test]
async fn a_manifest_with_no_metadata_still_submits() {
    let app = router(test_state());
    let token = make_user(&app, "bare@example.com").await;
    let manifest = serde_json::json!({
        "id": "bare-preset", "name": "Bare", "version": "1.0.0", "api": 1, "permissions": []
    })
    .to_string();

    let (status, _) = call(&app, "POST", "/submissions", Some(&token),
        Some(serde_json::json!({
            "kind": "preset", "manifest": manifest, "preset_json": "{}"
        }))).await;
    assert_eq!(status, StatusCode::OK, "metadata must stay optional");
}

#[tokio::test]
async fn an_invalid_category_is_rejected_at_submission() {
    let app = router(test_state());
    let token = make_user(&app, "badcat@example.com").await;
    let manifest = serde_json::json!({
        "id": "bad-cat", "name": "Bad", "version": "1.0.0", "api": 1, "permissions": [],
        "category": "weather"
    })
    .to_string();

    let (status, _) = call(&app, "POST", "/submissions", Some(&token),
        Some(serde_json::json!({
            "kind": "preset", "manifest": manifest, "preset_json": "{}"
        }))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "'weather' is not a preset category");
}

#[tokio::test]
async fn every_index_row_carries_the_market_v2_keys() {
    let app = router(test_state());
    let token = make_user(&app, "keys@example.com").await;
    let manifest = serde_json::json!({
        "id": "keyed", "name": "Keyed", "version": "1.0.0", "api": 1, "permissions": [],
        "summary": "has a summary", "category": "milkdrop", "tags": ["a"]
    })
    .to_string();
    call(&app, "POST", "/submissions", Some(&token),
        Some(serde_json::json!({"kind": "preset", "manifest": manifest, "preset_json": "{}"}))).await;

    let b = index_row(&app, "keyed").await;
    for key in ["summary", "description", "category", "tags", "icon", "changelog",
                "minAppVersion", "featured", "approvedAt", "mediaCount",
                "authorDisplay", "hasPreview"] {
        assert!(b.get(key).is_some(), "index row is missing the {key} key");
    }
    assert_eq!(b["mediaCount"], 0, "a bundle with no media rows reports zero");
    assert_eq!(b["featured"], false);
    assert_eq!(b["hasPreview"], false, "no preview blob and no media means false");
    // Absent metadata must serialize as null, never as a missing key -- the
    // app's optional TS fields distinguish "server said nothing" from "server
    // is too old to have the key" only by the key's presence.
    assert!(b["description"].is_null());
}

#[tokio::test]
async fn the_index_stays_signed_over_the_exact_bundles_array() {
    let app = router(test_state());
    let (status, body) = call(&app, "GET", "/index.json", None, None).await;
    assert_eq!(status, StatusCode::OK);
    // The signature is over the serialized `bundles` array string embedded
    // verbatim in the response. Enriching the rows must not change that
    // contract -- only the content of the array.
    assert!(body["sig"].as_str().is_some(), "index must stay signed");
    assert!(body["pubkey"].as_str().is_some(), "index must publish its pubkey");
    assert!(body["bundles"].is_array());
}

#[tokio::test]
async fn approving_a_bundle_stamps_approved_at() {
    let app = router(test_state());
    let token = make_user(&app, "stamp@example.com").await;

    let manifest = serde_json::json!({
        "id": "stamped", "name": "Stamped", "version": "1.0.0", "api": 1, "permissions": []
    })
    .to_string();
    call(&app, "POST", "/submissions", Some(&token),
        Some(serde_json::json!({
            "kind": "visualizer", "manifest": manifest, "code": "export function draw(){}"
        }))).await;

    let (status, _) = call(&app, "POST", "/admin/decide", Some("test-admin"),
        Some(serde_json::json!({
            "id": "stamped", "version": "1.0.0", "approve": true, "note": null
        }))).await;
    assert_eq!(status, StatusCode::OK);

    let b = index_row(&app, "stamped").await;
    assert!(
        b["approvedAt"].as_i64().unwrap_or(0) > 0,
        "approvedAt must be stamped when a human approves"
    );
}

#[tokio::test]
async fn admin_patch_backfills_metadata_without_touching_the_zip() {
    let app = router(test_state());
    let token = make_user(&app, "patch@example.com").await;
    seed_preset(&app, &token, "patchable").await;

    let before = index_row(&app, "patchable").await;
    let sha_before = before["sha256"].clone();

    let (status, _) = call(&app, "PATCH", "/admin/bundles/patchable/1.0.0", Some("test-admin"),
        Some(serde_json::json!({
            "summary": "Backfilled summary",
            "category": "milkdrop",
            "tags": ["backfilled"],
            "featured": true
        }))).await;
    assert_eq!(status, StatusCode::OK);

    let after = index_row(&app, "patchable").await;
    assert_eq!(after["summary"], "Backfilled summary");
    assert_eq!(after["tags"], serde_json::json!(["backfilled"]));
    assert_eq!(after["featured"], true);
    assert_eq!(after["sha256"], sha_before, "PATCH must never touch the zip or its hash");
}

#[tokio::test]
async fn admin_patch_leaves_absent_keys_alone_and_clears_on_empty_string() {
    let app = router(test_state());
    let token = make_user(&app, "partial@example.com").await;
    seed_preset(&app, &token, "partial").await;

    call(&app, "PATCH", "/admin/bundles/partial/1.0.0", Some("test-admin"),
        Some(serde_json::json!({"summary": "first", "description": "keep me"}))).await;
    call(&app, "PATCH", "/admin/bundles/partial/1.0.0", Some("test-admin"),
        Some(serde_json::json!({"summary": "second"}))).await;

    let row = index_row(&app, "partial").await;
    assert_eq!(row["summary"], "second");
    assert_eq!(row["description"], "keep me", "an absent key must not clear the column");

    call(&app, "PATCH", "/admin/bundles/partial/1.0.0", Some("test-admin"),
        Some(serde_json::json!({"description": ""}))).await;
    let row = index_row(&app, "partial").await;
    assert!(row["description"].is_null(), "empty string clears to NULL");
}

#[tokio::test]
async fn admin_patch_enforces_the_same_rules_as_submission() {
    let app = router(test_state());
    let token = make_user(&app, "rules@example.com").await;
    seed_preset(&app, &token, "ruled").await;

    let (status, _) = call(&app, "PATCH", "/admin/bundles/ruled/1.0.0", Some("test-admin"),
        Some(serde_json::json!({"category": "weather"}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "'weather' is not a preset category");

    let (status, _) = call(&app, "PATCH", "/admin/bundles/ruled/1.0.0", Some("test-admin"),
        Some(serde_json::json!({"summary": "x".repeat(101)}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn admin_patch_requires_the_admin_token() {
    let app = router(test_state());
    let token = make_user(&app, "noauth@example.com").await;
    seed_preset(&app, &token, "guarded").await;

    let (status, _) = call(&app, "PATCH", "/admin/bundles/guarded/1.0.0", None,
        Some(serde_json::json!({"summary": "nope"}))).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _) = call(&app, "PATCH", "/admin/bundles/guarded/1.0.0", Some(&token),
        Some(serde_json::json!({"summary": "nope"}))).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "a user session is not an admin token");
}
