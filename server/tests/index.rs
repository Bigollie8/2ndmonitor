use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use http_body_util::BodyExt;
use hub_marketplace::keys::verify_index;
use hub_marketplace::{router, test_state};
use sha2::{Digest, Sha256};
use tower::ServiceExt;

async fn call(
    app: &axum::Router,
    method: &str,
    uri: &str,
    token: Option<&str>,
    body: Option<serde_json::Value>,
) -> (StatusCode, Vec<u8>) {
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
    let bytes = res.into_body().collect().await.unwrap().to_bytes().to_vec();
    (status, bytes)
}

async fn setup_approved_preset(app: &axum::Router) {
    let (_, body) = call(app, "POST", "/auth/register", None,
        Some(serde_json::json!({"email": "a@b.c", "password": "hunter22"}))).await;
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let verify = v["verify_token"].as_str().unwrap().to_string();
    call(app, "GET", &format!("/auth/verify?token={verify}"), None, None).await;
    let (_, body) = call(app, "POST", "/auth/login", None,
        Some(serde_json::json!({"email": "a@b.c", "password": "hunter22"}))).await;
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let t = v["token"].as_str().unwrap().to_string();
    let (st, _) = call(app, "POST", "/submissions", Some(&t), Some(serde_json::json!({
        "kind": "preset",
        "manifest": serde_json::json!({"id":"cool-preset","name":"P","version":"1.0.0","api":1,"permissions":[]}).to_string(),
        "preset_json": "{\"baseVals\":{}}"
    }))).await;
    assert_eq!(st, StatusCode::OK);
    // Plus a pending visualizer that must NOT appear in the index.
    let (st, _) = call(app, "POST", "/submissions", Some(&t), Some(serde_json::json!({
        "kind": "visualizer",
        "manifest": serde_json::json!({"id":"pending-viz","name":"V","version":"1.0.0","api":1,"permissions":[]}).to_string(),
        "code": "x()"
    }))).await;
    assert_eq!(st, StatusCode::OK);
}

fn extract_bundles_str(raw: &str) -> String {
    // The signature covers the exact "bundles" array substring.
    let start = raw.find("\"bundles\":").unwrap() + "\"bundles\":".len();
    let rest = &raw[start..];
    let end = rest.rfind(",\"pubkey\"").unwrap();
    rest[..end].to_string()
}

#[tokio::test]
async fn index_lists_only_approved_and_signature_verifies() {
    let app = router(test_state());
    setup_approved_preset(&app).await;

    let (st, body) = call(&app, "GET", "/index.json", None, None).await;
    assert_eq!(st, StatusCode::OK);
    let raw = String::from_utf8(body).unwrap();
    let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let bundles = v["bundles"].as_array().unwrap();
    assert_eq!(bundles.len(), 1);
    assert_eq!(bundles[0]["id"], "cool-preset");
    assert_eq!(bundles[0]["author"], "a@b***");

    let bundles_str = extract_bundles_str(&raw);
    let sig = v["sig"].as_str().unwrap();
    let pubkey = v["pubkey"].as_str().unwrap();
    assert!(verify_index(&bundles_str, sig, pubkey), "signature must verify");

    // Tampered payload fails.
    let tampered = bundles_str.replace("cool-preset", "evil-preset");
    assert!(!verify_index(&tampered, sig, pubkey));
}

#[tokio::test]
async fn download_matches_sha_and_increments_count() {
    let app = router(test_state());
    setup_approved_preset(&app).await;

    let (st, zip1) = call(&app, "GET", "/bundle/cool-preset/1.0.0", None, None).await;
    assert_eq!(st, StatusCode::OK);
    let (_, idx) = call(&app, "GET", "/index.json", None, None).await;
    let v: serde_json::Value = serde_json::from_slice(&idx).unwrap();
    assert_eq!(v["bundles"][0]["downloads"], 1);
    assert_eq!(
        v["bundles"][0]["sha256"].as_str().unwrap(),
        hex::encode(Sha256::digest(&zip1))
    );

    // Pending bundle is not downloadable.
    let (st, _) = call(&app, "GET", "/bundle/pending-viz/1.0.0", None, None).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
}
