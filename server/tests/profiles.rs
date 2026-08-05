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

/// Register → verify → login, returning a session token. Dev email is on in
/// `Config::test()`, so the verify token comes back in the response.
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
async fn claiming_a_handle_then_reading_it_back() {
    let app = router(test_state());
    let token = account(&app, "claim@example.com").await;

    let (status, body) = call(
        &app,
        "POST",
        "/account/handle",
        Some(&token),
        Some(serde_json::json!({ "handle": "Oliver_J" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["handle"], "oliver_j", "the stored handle is normalised");

    let (status, body) = call(&app, "GET", "/account", Some(&token), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["handle"], "oliver_j");
    assert_eq!(body["avatarSeed"], "oliver_j", "the identicon seeds from the handle");
}

#[tokio::test]
async fn a_taken_handle_is_409() {
    let app = router(test_state());
    let first = account(&app, "first@example.com").await;
    let second = account(&app, "second@example.com").await;

    let (status, _) = call(&app, "POST", "/account/handle", Some(&first),
        Some(serde_json::json!({ "handle": "shared" }))).await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = call(&app, "POST", "/account/handle", Some(&second),
        Some(serde_json::json!({ "handle": "shared" }))).await;
    assert_eq!(status, StatusCode::CONFLICT, "the unique index decides this, not a pre-check");
}

/// Error bodies from these handlers are plain text, matching the
/// `(StatusCode, String)` convention media.rs and reviews.rs already use — so
/// asserting on the message needs the raw bytes, not a JSON parse.
async fn call_text(
    app: &axum::Router,
    method: &str,
    uri: &str,
    token: Option<&str>,
    body: Option<serde_json::Value>,
) -> (StatusCode, String) {
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
    (status, String::from_utf8_lossy(&bytes).into_owned())
}

#[tokio::test]
async fn an_invalid_handle_is_400_with_a_reason() {
    let app = router(test_state());
    let token = account(&app, "short@example.com").await;
    let (status, text) = call_text(&app, "POST", "/account/handle", Some(&token),
        Some(serde_json::json!({ "handle": "ab" }))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(
        text.contains("3 characters"),
        "the reason should name the rule, got {text:?}"
    );
}

#[tokio::test]
async fn a_reserved_handle_is_rejected() {
    let app = router(test_state());
    let token = account(&app, "reserved@example.com").await;
    let (status, _) = call(&app, "POST", "/account/handle", Some(&token),
        Some(serde_json::json!({ "handle": "admin" }))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

// Changing a handle would let a creator shed a reputation and would rot every
// link to their work, so it is an admin action rather than a self-service one.
#[tokio::test]
async fn a_handle_cannot_be_changed_once_set() {
    let app = router(test_state());
    let token = account(&app, "once@example.com").await;
    let (status, _) = call(&app, "POST", "/account/handle", Some(&token),
        Some(serde_json::json!({ "handle": "first-choice" }))).await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = call(&app, "POST", "/account/handle", Some(&token),
        Some(serde_json::json!({ "handle": "second-choice" }))).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn the_account_endpoint_never_returns_a_raw_email() {
    let app = router(test_state());
    let token = account(&app, "private@example.com").await;
    let (status, body) = call(&app, "GET", "/account", Some(&token), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["email"], "pri***");
    assert!(
        !body.to_string().contains("private@example.com"),
        "no raw address may appear anywhere in the response"
    );
}

#[tokio::test]
async fn an_unauthenticated_request_is_401() {
    let app = router(test_state());
    let (status, _) = call(&app, "GET", "/account", None, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn bio_and_links_round_trip() {
    let app = router(test_state());
    let token = account(&app, "bio@example.com").await;
    let (status, _) = call(&app, "PATCH", "/account", Some(&token), Some(serde_json::json!({
        "displayName": "Oliver",
        "bio": "Builds dashboards.",
        "links": ["https://example.com"]
    }))).await;
    assert_eq!(status, StatusCode::OK);

    let (_, body) = call(&app, "GET", "/account", Some(&token), None).await;
    assert_eq!(body["displayName"], "Oliver");
    assert_eq!(body["bio"], "Builds dashboards.");
    assert_eq!(body["links"][0], "https://example.com");
}

#[tokio::test]
async fn profile_fields_are_capped_and_https_only() {
    let app = router(test_state());
    let token = account(&app, "caps@example.com").await;

    let (status, _) = call(&app, "PATCH", "/account", Some(&token),
        Some(serde_json::json!({ "bio": "x".repeat(281) }))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "bio over 280 chars");

    let (status, _) = call(&app, "PATCH", "/account", Some(&token),
        Some(serde_json::json!({ "links": ["https://a.com","https://b.com","https://c.com","https://d.com"] }))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "more than 3 links");

    // An http link in a profile rendered inside the app is both a downgrade
    // and a mixed-content problem.
    let (status, _) = call(&app, "PATCH", "/account", Some(&token),
        Some(serde_json::json!({ "links": ["http://insecure.example"] }))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "http must be rejected");

    let (status, _) = call(&app, "PATCH", "/account", Some(&token),
        Some(serde_json::json!({ "displayName": "   " }))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "blank display name");
}

// ── the public creator page ────────────────────────────────────────────────

#[tokio::test]
async fn a_creator_page_lists_their_approved_work() {
    let state = test_state();
    {
        let db = state.db.lock();
        db.execute(
            "INSERT INTO users (id,email,pass_hash,verified,created_at,handle,display_name,bio)
             VALUES (5,'c@x','h',1,100,'maker','The Maker','Builds things.')",
            [],
        ).unwrap();
        db.execute(
            "INSERT INTO bundles (id,version,kind,name,author_id,status,manifest,sha256,size,created_at,downloads)
             VALUES ('shipped','1.0.0','visualizer','Shipped',5,'approved','{}','a',1,100,7)",
            [],
        ).unwrap();
        // Pending work must not appear: a creator page may never surface
        // something the catalog itself would not.
        db.execute(
            "INSERT INTO bundles (id,version,kind,name,author_id,status,manifest,sha256,size,created_at)
             VALUES ('draft','1.0.0','visualizer','Draft',5,'pending','{}','b',1,100)",
            [],
        ).unwrap();
    }
    let app = router(state);

    let (status, body) = call(&app, "GET", "/creators/maker", None, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["displayName"], "The Maker");
    assert_eq!(body["bio"], "Builds things.");
    assert_eq!(body["totalDownloads"], 7);
    let ids: Vec<&str> = body["bundles"].as_array().unwrap()
        .iter().map(|b| b["id"].as_str().unwrap()).collect();
    assert_eq!(ids, vec!["shipped"], "pending work must not be listed");
}

#[tokio::test]
async fn an_unknown_handle_is_404() {
    let app = router(test_state());
    let (status, _) = call(&app, "GET", "/creators/nobody", None, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

// Hiding the content is the entire point of a suspension; a page saying
// "this person exists but has nothing" still hands them a surface.
#[tokio::test]
async fn a_suspended_creator_is_404_not_an_empty_page() {
    let state = test_state();
    {
        let db = state.db.lock();
        db.execute(
            "INSERT INTO users (id,email,pass_hash,verified,created_at,handle,suspended)
             VALUES (6,'s@x','h',1,100,'banned',1)",
            [],
        ).unwrap();
    }
    let app = router(state);
    let (status, _) = call(&app, "GET", "/creators/banned", None, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn a_handle_lookup_is_case_insensitive() {
    let state = test_state();
    {
        let db = state.db.lock();
        db.execute(
            "INSERT INTO users (id,email,pass_hash,verified,created_at,handle)
             VALUES (7,'m@x','h',1,100,'mixedcase')",
            [],
        ).unwrap();
    }
    let app = router(state);
    let (status, body) = call(&app, "GET", "/creators/MixedCase", None, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["handle"], "mixedcase");
}

#[tokio::test]
async fn the_creator_page_never_exposes_an_email() {
    let state = test_state();
    {
        let db = state.db.lock();
        db.execute(
            "INSERT INTO users (id,email,pass_hash,verified,created_at,handle)
             VALUES (8,'secret@example.com','h',1,100,'quiet')",
            [],
        ).unwrap();
    }
    let app = router(state);
    let (_, body) = call(&app, "GET", "/creators/quiet", None, None).await;
    assert!(
        !body.to_string().contains("secret@example.com"),
        "a public page must not carry the address, masked or otherwise"
    );
}
