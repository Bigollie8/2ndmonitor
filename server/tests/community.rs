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
    let mut req = Request::builder().method(method).uri(uri).header("x-forwarded-for", "4.4.4.4");
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
    (status, serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null))
}

async fn account(app: &axum::Router, email: &str, handle: Option<&str>) -> String {
    let (_, body) = call(app, "POST", "/auth/register", None,
        Some(serde_json::json!({ "email": email, "password": "hunter22222" }))).await;
    let verify = body["verify_token"].as_str().unwrap().to_string();
    call(app, "GET", &format!("/auth/verify?token={verify}"), None, None).await;
    let (_, body) = call(app, "POST", "/auth/login", None,
        Some(serde_json::json!({ "email": email, "password": "hunter22222" }))).await;
    let token = body["token"].as_str().unwrap().to_string();
    if let Some(h) = handle {
        call(app, "POST", "/account/handle", Some(&token),
            Some(serde_json::json!({ "handle": h }))).await;
    }
    token
}

const ADMIN: &str = "test-admin";

// ── directory ───────────────────────────────────────────────────────────────

#[tokio::test]
async fn the_directory_lists_claimed_handles_and_searches_them() {
    let app = router(test_state());
    account(&app, "d1@x.y", Some("aurora")).await;
    account(&app, "d2@x.y", Some("borealis")).await;

    let (st, body) = call(&app, "GET", "/creators", None, None).await;
    assert_eq!(st, StatusCode::OK);
    let all: Vec<&str> = body["creators"].as_array().unwrap()
        .iter().map(|c| c["handle"].as_str().unwrap()).collect();
    assert!(all.contains(&"aurora") && all.contains(&"borealis"));

    let (_, body) = call(&app, "GET", "/creators?q=auro", None, None).await;
    let found: Vec<&str> = body["creators"].as_array().unwrap()
        .iter().map(|c| c["handle"].as_str().unwrap()).collect();
    assert_eq!(found, vec!["aurora"]);
}

// An account that never claimed a handle has deliberately not joined the
// public side. Listing it would publish someone who never asked to be.
#[tokio::test]
async fn accounts_without_a_handle_are_not_in_the_directory() {
    let app = router(test_state());
    account(&app, "lurker@x.y", None).await;
    let (_, body) = call(&app, "GET", "/creators", None, None).await;
    assert_eq!(body["creators"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn a_suspended_creator_leaves_the_directory() {
    let app = router(test_state());
    account(&app, "bad@x.y", Some("troublemaker")).await;
    call(&app, "POST", "/admin/moderate", Some(ADMIN),
        Some(serde_json::json!({ "action": "suspend", "handle": "troublemaker" }))).await;
    let (_, body) = call(&app, "GET", "/creators", None, None).await;
    assert_eq!(body["creators"].as_array().unwrap().len(), 0);
}

// A search box must be able to contain a percent sign without turning into a
// wildcard that matches everyone.
#[tokio::test]
async fn a_percent_in_the_search_is_a_literal_percent() {
    let app = router(test_state());
    account(&app, "pc@x.y", Some("normal")).await;
    let (_, body) = call(&app, "GET", "/creators?q=%25", None, None).await;
    assert_eq!(body["creators"].as_array().unwrap().len(), 0,
        "'%' must not behave as a LIKE wildcard");
}

// ── badges ──────────────────────────────────────────────────────────────────

#[tokio::test]
async fn badges_are_admin_granted_and_appear_on_the_public_page() {
    let app = router(test_state());
    account(&app, "b1@x.y", Some("founder1")).await;

    let (st, _) = call(&app, "POST", "/admin/moderate", Some(ADMIN),
        Some(serde_json::json!({ "action": "grant-badge", "handle": "founder1", "badge": "founder" }))).await;
    assert_eq!(st, StatusCode::OK);

    let (_, page) = call(&app, "GET", "/creators/founder1", None, None).await;
    assert_eq!(page["badges"][0], "founder");

    // Granting twice must not duplicate.
    call(&app, "POST", "/admin/moderate", Some(ADMIN),
        Some(serde_json::json!({ "action": "grant-badge", "handle": "founder1", "badge": "founder" }))).await;
    let (_, page) = call(&app, "GET", "/creators/founder1", None, None).await;
    assert_eq!(page["badges"].as_array().unwrap().len(), 1);

    call(&app, "POST", "/admin/moderate", Some(ADMIN),
        Some(serde_json::json!({ "action": "revoke-badge", "handle": "founder1", "badge": "founder" }))).await;
    let (_, page) = call(&app, "GET", "/creators/founder1", None, None).await;
    assert_eq!(page["badges"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn nobody_can_grant_themselves_a_badge() {
    let app = router(test_state());
    let me = account(&app, "b2@x.y", Some("wannabe")).await;
    let (st, _) = call(&app, "POST", "/admin/moderate", Some(&me),
        Some(serde_json::json!({ "action": "grant-badge", "handle": "wannabe", "badge": "moderator" }))).await;
    assert_eq!(st, StatusCode::FORBIDDEN);

    // And PATCHing your own account cannot smuggle one in.
    call(&app, "PATCH", "/account", Some(&me),
        Some(serde_json::json!({ "badges": ["moderator"] }))).await;
    let (_, page) = call(&app, "GET", "/creators/wannabe", None, None).await;
    assert_eq!(page["badges"].as_array().unwrap().len(), 0,
        "badges must not be writable through the account patch");
}

// ── profile accent ──────────────────────────────────────────────────────────

#[tokio::test]
async fn an_accent_must_be_a_colour_and_nothing_else() {
    let app = router(test_state());
    let me = account(&app, "acc@x.y", Some("painter")).await;

    let (st, _) = call(&app, "PATCH", "/account", Some(&me),
        Some(serde_json::json!({ "accent": "#7C5CFF" }))).await;
    assert_eq!(st, StatusCode::OK);
    let (_, page) = call(&app, "GET", "/creators/painter", None, None).await;
    assert_eq!(page["accent"], "#7c5cff", "stored lowercased");

    for bad in ["url(x)", "red", "#fff", "javascript:alert(1)", "#gggggg"] {
        let (st, _) = call(&app, "PATCH", "/account", Some(&me),
            Some(serde_json::json!({ "accent": bad }))).await;
        assert_eq!(st, StatusCode::BAD_REQUEST, "{bad} must be rejected");
    }
}

// ── forum ───────────────────────────────────────────────────────────────────

#[tokio::test]
async fn a_topic_and_its_replies_round_trip() {
    let app = router(test_state());
    let a = account(&app, "f1@x.y", Some("poster")).await;

    let (st, body) = call(&app, "POST", "/topics", Some(&a),
        Some(serde_json::json!({ "title": "Best layout?", "body": "Show me yours." }))).await;
    assert_eq!(st, StatusCode::OK);
    let id = body["id"].as_i64().unwrap();

    let (_, list) = call(&app, "GET", "/topics", None, None).await;
    assert_eq!(list["topics"][0]["title"], "Best layout?");
    assert_eq!(list["topics"][0]["handle"], "poster");

    let (st, _) = call(&app, "POST", "/topics/replies", Some(&a),
        Some(serde_json::json!({ "topicId": id, "body": "here is mine" }))).await;
    assert_eq!(st, StatusCode::OK);

    let (_, replies) = call(&app, "GET", &format!("/topics/replies?topicId={id}"), None, None).await;
    assert_eq!(replies["replies"].as_array().unwrap().len(), 1);

    let (_, list) = call(&app, "GET", "/topics", None, None).await;
    assert_eq!(list["topics"][0]["replyCount"], 1, "reply count is denormalised on write");
}

#[tokio::test]
async fn posting_a_topic_needs_a_claimed_handle() {
    let app = router(test_state());
    let nameless = account(&app, "f2@x.y", None).await;
    let (st, _) = call(&app, "POST", "/topics", Some(&nameless),
        Some(serde_json::json!({ "title": "hi", "body": "hi" }))).await;
    assert_eq!(st, StatusCode::FORBIDDEN);
}

// Hiding a topic has to actually stop the conversation, or moderation is
// theatre.
#[tokio::test]
async fn a_hidden_topic_disappears_and_refuses_new_replies() {
    let app = router(test_state());
    let a = account(&app, "f3@x.y", Some("hidden-poster")).await;
    let (_, body) = call(&app, "POST", "/topics", Some(&a),
        Some(serde_json::json!({ "title": "spam", "body": "buy things" }))).await;
    let id = body["id"].as_i64().unwrap();

    call(&app, "POST", "/admin/moderate", Some(ADMIN),
        Some(serde_json::json!({ "action": "hide-topic", "id": id }))).await;

    let (_, list) = call(&app, "GET", "/topics", None, None).await;
    assert_eq!(list["topics"].as_array().unwrap().len(), 0);

    let (st, _) = call(&app, "POST", "/topics/replies", Some(&a),
        Some(serde_json::json!({ "topicId": id, "body": "still here" }))).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn a_topic_can_hang_off_one_bundle() {
    let app = router(test_state());
    let a = account(&app, "f4@x.y", Some("bundler")).await;
    call(&app, "POST", "/topics", Some(&a),
        Some(serde_json::json!({ "title": "about this viz", "body": "q", "bundleId": "cool-viz" }))).await;
    call(&app, "POST", "/topics", Some(&a),
        Some(serde_json::json!({ "title": "general", "body": "q" }))).await;

    let (_, scoped) = call(&app, "GET", "/topics?bundleId=cool-viz", None, None).await;
    assert_eq!(scoped["topics"].as_array().unwrap().len(), 1);
    assert_eq!(scoped["topics"][0]["bundleId"], "cool-viz");
}

// Storing it verbatim and rendering it as text is the whole XSS story.
#[tokio::test]
async fn forum_bodies_are_stored_verbatim() {
    let app = router(test_state());
    let a = account(&app, "f5@x.y", Some("scripter")).await;
    let payload = "<script>alert('x')</script> **not bold**";
    call(&app, "POST", "/topics", Some(&a),
        Some(serde_json::json!({ "title": "t", "body": payload }))).await;
    let (_, list) = call(&app, "GET", "/topics", None, None).await;
    assert_eq!(list["topics"][0]["body"], payload);
}

// ── shoutbox ────────────────────────────────────────────────────────────────

#[tokio::test]
async fn shouts_round_trip_oldest_first() {
    let app = router(test_state());
    let a = account(&app, "s1@x.y", Some("shouter")).await;

    let (st, _) = call(&app, "POST", "/shouts", Some(&a),
        Some(serde_json::json!({ "body": "hello world" }))).await;
    assert_eq!(st, StatusCode::OK);

    let (st, body) = call(&app, "GET", "/shouts", None, None).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(body["shouts"][0]["body"], "hello world");
    assert_eq!(body["shouts"][0]["handle"], "shouter");
    assert!(body["cooldown"].as_i64().unwrap() > 0);
}

// Flooding is the failure mode of every shoutbox ever built, and a
// client-side throttle stops exactly nobody.
#[tokio::test]
async fn the_cooldown_is_enforced_server_side() {
    let app = router(test_state());
    let a = account(&app, "s2@x.y", Some("flooder")).await;
    call(&app, "POST", "/shouts", Some(&a), Some(serde_json::json!({ "body": "one" }))).await;
    let (st, _) = call(&app, "POST", "/shouts", Some(&a),
        Some(serde_json::json!({ "body": "two" }))).await;
    assert_eq!(st, StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn shouting_needs_a_handle_and_a_body() {
    let app = router(test_state());
    let nameless = account(&app, "s3@x.y", None).await;
    let (st, _) = call(&app, "POST", "/shouts", Some(&nameless),
        Some(serde_json::json!({ "body": "hi" }))).await;
    assert_eq!(st, StatusCode::FORBIDDEN);

    let named = account(&app, "s4@x.y", Some("blanker")).await;
    let (st, _) = call(&app, "POST", "/shouts", Some(&named),
        Some(serde_json::json!({ "body": "   " }))).await;
    assert_eq!(st, StatusCode::BAD_REQUEST);

    let (st, _) = call(&app, "POST", "/shouts", None,
        Some(serde_json::json!({ "body": "anon" }))).await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn a_hidden_shout_stops_being_served() {
    let app = router(test_state());
    let a = account(&app, "s5@x.y", Some("hidden-shouter")).await;
    call(&app, "POST", "/shouts", Some(&a), Some(serde_json::json!({ "body": "bad thing" }))).await;
    let (_, body) = call(&app, "GET", "/shouts", None, None).await;
    let id = body["shouts"][0]["id"].as_i64().unwrap();

    call(&app, "POST", "/admin/moderate", Some(ADMIN),
        Some(serde_json::json!({ "action": "hide-shout", "id": id }))).await;

    let (_, body) = call(&app, "GET", "/shouts", None, None).await;
    assert_eq!(body["shouts"].as_array().unwrap().len(), 0);
}
