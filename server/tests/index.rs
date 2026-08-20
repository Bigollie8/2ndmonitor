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
    // 0.9.0: publishing requires a claimed handle, and the index now carries
    // it as `authorHandle`.
    call(app, "POST", "/account/handle", Some(&t),
        Some(serde_json::json!({ "handle": "indexer" }))).await;
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

async fn make_user(app: &axum::Router, email: &str) -> String {
    let (_, body) = call(app, "POST", "/auth/register", None,
        Some(serde_json::json!({"email": email, "password": "hunter22"}))).await;
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let verify = v["verify_token"].as_str().unwrap().to_string();
    call(app, "GET", &format!("/auth/verify?token={verify}"), None, None).await;
    let (_, body) = call(app, "POST", "/auth/login", None,
        Some(serde_json::json!({"email": email, "password": "hunter22"}))).await;
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let token = v["token"].as_str().unwrap().to_string();
    // 0.9.0: publishing requires a claimed handle. From the WHOLE address,
    // since "a@b.c" has a one-character local part and the minimum is three.
    let slug: String = email.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    let handle: String = format!("u{slug}").chars().take(24).collect();
    call(app, "POST", "/account/handle", Some(&token),
        Some(serde_json::json!({ "handle": handle }))).await;
    token
}

fn png_bytes() -> Vec<u8> {
    [vec![0x89u8, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A], vec![0u8; 16]].concat()
}

/// The index's `hasPreview` field must reflect whether a `preview` BLOB is
/// stored, and adding the field must not disturb the signed substring — the
/// signature still has to verify over the (now-larger) `bundles` array.
#[tokio::test]
async fn index_reports_has_preview_and_signature_still_verifies() {
    use base64::Engine;
    let app = router(test_state());
    let t = make_user(&app, "a@b.c").await;
    let preview_b64 = base64::engine::general_purpose::STANDARD.encode(png_bytes());

    let (st, _) = call(&app, "POST", "/submissions", Some(&t), Some(serde_json::json!({
        "kind": "preset",
        "manifest": serde_json::json!({"id":"with-preview","name":"P","version":"1.0.0","api":1,"permissions":[]}).to_string(),
        "preset_json": "{\"baseVals\":{}}",
        "preview": preview_b64,
    }))).await;
    assert_eq!(st, StatusCode::OK);
    let (st, _) = call(&app, "POST", "/submissions", Some(&t), Some(serde_json::json!({
        "kind": "preset",
        "manifest": serde_json::json!({"id":"without-preview","name":"P","version":"1.0.0","api":1,"permissions":[]}).to_string(),
        "preset_json": "{\"baseVals\":{}}",
    }))).await;
    assert_eq!(st, StatusCode::OK);

    let (st, body) = call(&app, "GET", "/index.json", None, None).await;
    assert_eq!(st, StatusCode::OK);
    let raw = String::from_utf8(body).unwrap();
    let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let bundles = v["bundles"].as_array().unwrap();
    let with = bundles.iter().find(|b| b["id"] == "with-preview").unwrap();
    let without = bundles.iter().find(|b| b["id"] == "without-preview").unwrap();
    assert_eq!(with["hasPreview"], serde_json::json!(true));
    assert_eq!(without["hasPreview"], serde_json::json!(false));

    let bundles_str = extract_bundles_str(&raw);
    let sig = v["sig"].as_str().unwrap();
    let pubkey = v["pubkey"].as_str().unwrap();
    assert!(verify_index(&bundles_str, sig, pubkey), "signature must verify with hasPreview present");
}

/// An unapproved bundle's preview must not leak through the preview
/// endpoint, exactly like the zip download.
#[tokio::test]
async fn preview_endpoint_404s_for_unapproved_bundle() {
    use base64::Engine;
    let app = router(test_state());
    let t = make_user(&app, "a@b.c").await;
    let preview_b64 = base64::engine::general_purpose::STANDARD.encode(png_bytes());

    let (st, _) = call(&app, "POST", "/submissions", Some(&t), Some(serde_json::json!({
        "kind": "visualizer",
        "manifest": serde_json::json!({"id":"pending-with-preview","name":"V","version":"1.0.0","api":1,"permissions":[]}).to_string(),
        "code": "x()",
        "preview": preview_b64,
    }))).await;
    assert_eq!(st, StatusCode::OK);

    let (st, _) = call(&app, "GET", "/bundle/pending-with-preview/1.0.0/preview", None, None).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
}

/// An approved bundle with no stored preview 404s; one with a preview
/// serves the raw bytes with a content type sniffed from the bytes.
#[tokio::test]
async fn preview_endpoint_404s_without_preview_and_serves_sniffed_mime_with_one() {
    use base64::Engine;
    let app = router(test_state());
    let t = make_user(&app, "a@b.c").await;
    let png = png_bytes();
    let preview_b64 = base64::engine::general_purpose::STANDARD.encode(&png);

    let (st, _) = call(&app, "POST", "/submissions", Some(&t), Some(serde_json::json!({
        "kind": "preset",
        "manifest": serde_json::json!({"id":"preview-preset","name":"P","version":"1.0.0","api":1,"permissions":[]}).to_string(),
        "preset_json": "{\"baseVals\":{}}",
        "preview": preview_b64,
    }))).await;
    assert_eq!(st, StatusCode::OK);
    let (st, _) = call(&app, "POST", "/submissions", Some(&t), Some(serde_json::json!({
        "kind": "preset",
        "manifest": serde_json::json!({"id":"no-preview-preset","name":"P","version":"1.0.0","api":1,"permissions":[]}).to_string(),
        "preset_json": "{\"baseVals\":{}}",
    }))).await;
    assert_eq!(st, StatusCode::OK);

    // No preview stored -> 404, even though the bundle itself is approved.
    let (st, _) = call(&app, "GET", "/bundle/no-preview-preset/1.0.0/preview", None, None).await;
    assert_eq!(st, StatusCode::NOT_FOUND);

    // Preview stored -> 200 with a mime type sniffed from the bytes.
    let req = Request::builder()
        .method("GET")
        .uri("/bundle/preview-preset/1.0.0/preview")
        .header("x-forwarded-for", "1.1.1.1")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(res.headers().get(header::CONTENT_TYPE).unwrap(), "image/png");
    let bytes = res.into_body().collect().await.unwrap().to_bytes().to_vec();
    assert_eq!(bytes, png);
}

/// Attribution rides the SIGNED payload: a card can link to a creator with no
/// second fetch, and the link cannot be altered in transit.
#[tokio::test]
async fn the_index_carries_the_author_handle() {
    let app = router(test_state());
    setup_approved_preset(&app).await;

    let (st, body) = call(&app, "GET", "/index.json", None, None).await;
    assert_eq!(st, StatusCode::OK);
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let b = v["bundles"]
        .as_array()
        .unwrap()
        .iter()
        .find(|b| b["id"] == "cool-preset")
        .expect("the approved preset is in the index");
    assert_eq!(b["authorHandle"], "indexer");
}

/// Null rather than an empty string: an author who has not claimed a handle
/// has no handle, and "" would render as a link to nowhere.
#[tokio::test]
async fn an_author_with_no_handle_yields_null() {
    let state = test_state();
    {
        let db = state.db.lock();
        db.execute(
            "INSERT INTO users (id, email, pass_hash, verified, created_at) VALUES (9,'nohandle@x','h',1,0)",
            [],
        )
        .unwrap();
        db.execute(
            "INSERT INTO bundles (id, version, kind, name, author_id, status, manifest, sha256, size, created_at)
             VALUES ('orphan','1.0.0','visualizer','Orphan',9,'approved','{}','deadbeef',10,100)",
            [],
        )
        .unwrap();
    }
    let app = router(state);

    let (st, body) = call(&app, "GET", "/index.json", None, None).await;
    assert_eq!(st, StatusCode::OK);
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let b = v["bundles"]
        .as_array()
        .unwrap()
        .iter()
        .find(|b| b["id"] == "orphan")
        .expect("the bundle is still listed");
    assert!(b["authorHandle"].is_null(), "no handle means null, not an empty string");
}

/// The public read-only surface is fetched directly by browsers — the studio
/// site's /market/ shelf among them — so it carries open CORS. This is signed
/// public data; authored and admin endpoints stay same-origin-only.
#[tokio::test]
async fn public_read_endpoints_carry_open_cors() {
    let app = router(test_state());
    setup_approved_preset(&app).await;

    for uri in ["/index.json", "/bundle/cool-preset/1.0.0"] {
        let req = Request::builder()
            .method("GET")
            .uri(uri)
            .header("x-forwarded-for", "1.1.1.1")
            .body(Body::empty())
            .unwrap();
        let res = app.clone().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK, "{uri}");
        assert_eq!(
            res.headers()
                .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
                .map(|v| v.to_str().unwrap()),
            Some("*"),
            "{uri} must allow cross-origin reads"
        );
    }
}

/// The site signs in and posts (ratings, reviews, favourites) from the
/// browser, cross-origin: those requests preflight. Per-handler headers
/// cannot answer OPTIONS — the CORS layer must.
#[tokio::test]
async fn preflight_and_authed_calls_carry_cors() {
    let app = router(test_state());

    let req = Request::builder()
        .method("OPTIONS")
        .uri("/auth/login")
        .header("origin", "http://localhost:8080")
        .header("access-control-request-method", "POST")
        .header("access-control-request-headers", "content-type, authorization")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert!(res.status().is_success(), "preflight must succeed, got {}", res.status());
    let allow_origin = res.headers().get(header::ACCESS_CONTROL_ALLOW_ORIGIN);
    assert_eq!(allow_origin.map(|v| v.to_str().unwrap()), Some("*"));
    let allow_headers = res.headers().get(header::ACCESS_CONTROL_ALLOW_HEADERS)
        .map(|v| v.to_str().unwrap().to_lowercase()).unwrap_or_default();
    assert!(allow_headers.contains("authorization"), "authorization must be allowed, got {allow_headers}");
    assert!(allow_headers.contains("content-type"), "content-type must be allowed, got {allow_headers}");

    // A plain authed GET carries the header too (the layer covers everything).
    let req = Request::builder()
        .method("GET")
        .uri("/auth/whoami")
        .header("origin", "http://localhost:8080")
        .header("x-forwarded-for", "1.1.1.1")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(
        res.headers().get(header::ACCESS_CONTROL_ALLOW_ORIGIN).map(|v| v.to_str().unwrap()),
        Some("*"),
        "even a 401 response must carry CORS so the browser can read the status"
    );
}
