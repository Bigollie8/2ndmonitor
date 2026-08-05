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

// ── avatars ─────────────────────────────────────────────────────────────────

/// Smallest valid PNG: signature + a stub. Only the magic number is checked,
/// which is the whole point — the sniff decides, not a declared type.
fn png_bytes() -> Vec<u8> {
    let mut v = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    v.extend_from_slice(&[0u8; 32]);
    v
}

fn b64(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

#[tokio::test]
async fn an_avatar_uploads_serves_and_clears() {
    let app = router(test_state());
    let me = account(&app, "av1@x.y", Some("pictured")).await;

    // No picture yet: 404, so the client falls back to the identicon rather
    // than rendering a broken image.
    let (st, _) = call(&app, "GET", "/creators/pictured/avatar", None, None).await;
    assert_eq!(st, StatusCode::NOT_FOUND);

    let (st, body) = call(&app, "POST", "/account/avatar", Some(&me),
        Some(serde_json::json!({ "image": b64(&png_bytes()) }))).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(body["hasAvatar"], true);

    let (st, _) = call(&app, "GET", "/creators/pictured/avatar", None, None).await;
    assert_eq!(st, StatusCode::OK);

    let (_, page) = call(&app, "GET", "/creators/pictured", None, None).await;
    assert_eq!(page["hasAvatar"], true);

    // Empty clears it — how someone goes back to their identicon.
    call(&app, "POST", "/account/avatar", Some(&me),
        Some(serde_json::json!({ "image": "" }))).await;
    let (st, _) = call(&app, "GET", "/creators/pictured/avatar", None, None).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
}

// Sniffed, never trusted. There is no content-type header here, just base64
// in a JSON field, so a caller's say-so about the format means nothing.
#[tokio::test]
async fn only_png_and_jpeg_bytes_are_accepted() {
    let app = router(test_state());
    let me = account(&app, "av2@x.y", Some("sniffed")).await;

    for bad in [
        b64(b"<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>"),
        b64(b"GIF89a not really"),
        b64(b"%PDF-1.4"),
        "not base64 at all!!".to_string(),
    ] {
        let (st, _) = call(&app, "POST", "/account/avatar", Some(&me),
            Some(serde_json::json!({ "image": bad }))).await;
        assert_eq!(st, StatusCode::BAD_REQUEST);
    }
}

#[tokio::test]
async fn an_oversize_avatar_is_refused() {
    let app = router(test_state());
    let me = account(&app, "av3@x.y", Some("bigpic")).await;
    let mut huge = png_bytes();
    huge.resize(600 * 1024, 0);
    let (st, _) = call(&app, "POST", "/account/avatar", Some(&me),
        Some(serde_json::json!({ "image": b64(&huge) }))).await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn uploading_an_avatar_needs_a_session() {
    let app = router(test_state());
    let (st, _) = call(&app, "POST", "/account/avatar", None,
        Some(serde_json::json!({ "image": b64(&png_bytes()) }))).await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);
}

// A face is the most visible thing somebody has, so hiding them has to hide
// it. And an admin can remove one picture WITHOUT suspending the person,
// which would take all their work down too.
#[tokio::test]
async fn suspension_hides_an_avatar_and_admins_can_remove_one_on_its_own() {
    let app = router(test_state());
    let me = account(&app, "av4@x.y", Some("suspendee")).await;
    call(&app, "POST", "/account/avatar", Some(&me),
        Some(serde_json::json!({ "image": b64(&png_bytes()) }))).await;

    call(&app, "POST", "/admin/moderate", Some(ADMIN),
        Some(serde_json::json!({ "action": "suspend", "handle": "suspendee" }))).await;
    let (st, _) = call(&app, "GET", "/creators/suspendee/avatar", None, None).await;
    assert_eq!(st, StatusCode::NOT_FOUND);

    call(&app, "POST", "/admin/moderate", Some(ADMIN),
        Some(serde_json::json!({ "action": "unsuspend", "handle": "suspendee" }))).await;
    let (st, _) = call(&app, "GET", "/creators/suspendee/avatar", None, None).await;
    assert_eq!(st, StatusCode::OK, "unsuspending restores it");

    call(&app, "POST", "/admin/moderate", Some(ADMIN),
        Some(serde_json::json!({ "action": "remove-avatar", "handle": "suspendee" }))).await;
    let (st, _) = call(&app, "GET", "/creators/suspendee/avatar", None, None).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
}

// ── report kinds ────────────────────────────────────────────────────────────

// The bug this pins: forum replies and shouts were filed as "comment", so the
// queue's hide button ran UPDATE comments against an id from another table,
// matched nothing, and reported success.
#[tokio::test]
async fn every_reportable_surface_has_its_own_kind() {
    let app = router(test_state());
    let me = account(&app, "rk1@x.y", Some("reporter1")).await;

    for kind in ["comment", "review", "bundle", "creator", "topic", "reply", "shout"] {
        let (st, _) = call(&app, "POST", "/reports", Some(&me), Some(serde_json::json!({
            "targetKind": kind, "targetId": "1", "reason": "test",
        }))).await;
        assert_eq!(st, StatusCode::OK, "{kind} must be reportable");
    }

    let (st, _) = call(&app, "POST", "/reports", Some(&me), Some(serde_json::json!({
        "targetKind": "nonsense", "targetId": "1", "reason": "test",
    }))).await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
}

// A moderation action that changed nothing must not report success — that is
// what made a broken hide button look like a working one.
#[tokio::test]
async fn hiding_something_that_does_not_exist_is_a_404_not_an_ok() {
    let app = router(test_state());
    for action in ["hide-comment", "hide-reply", "hide-topic", "hide-shout"] {
        let (st, _) = call(&app, "POST", "/admin/moderate", Some(ADMIN),
            Some(serde_json::json!({ "action": action, "id": 999_999 }))).await;
        assert_eq!(st, StatusCode::NOT_FOUND, "{action} on a missing row");
    }
}

#[tokio::test]
async fn hiding_a_real_shout_still_works_and_reports_success() {
    let app = router(test_state());
    let a = account(&app, "rk2@x.y", Some("shouty")).await;
    call(&app, "POST", "/shouts", Some(&a), Some(serde_json::json!({ "body": "hello" }))).await;
    let (_, body) = call(&app, "GET", "/shouts", None, None).await;
    let id = body["shouts"][0]["id"].as_i64().unwrap();

    let (st, _) = call(&app, "POST", "/admin/moderate", Some(ADMIN),
        Some(serde_json::json!({ "action": "hide-shout", "id": id }))).await;
    assert_eq!(st, StatusCode::OK);

    let (_, after) = call(&app, "GET", "/shouts", None, None).await;
    assert_eq!(after["shouts"].as_array().unwrap().len(), 0);
}


// ── notifications ───────────────────────────────────────────────────────────

#[tokio::test]
async fn following_someone_lands_in_their_inbox() {
    let app = router(test_state());
    let a = account(&app, "n1@x.y", Some("follower1")).await;
    let b = account(&app, "n2@x.y", Some("followed1")).await;

    call(&app, "POST", "/follows", Some(&a), Some(serde_json::json!({ "handle": "followed1" }))).await;

    let (st, inbox) = call(&app, "GET", "/notifications", Some(&b), None).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(inbox["unread"], 1);
    assert_eq!(inbox["notifications"][0]["kind"], "follow");
    assert_eq!(inbox["notifications"][0]["actor"], "follower1");
}

// You are never told about your own actions.
#[tokio::test]
async fn your_own_actions_never_notify_you() {
    let app = router(test_state());
    let me = account(&app, "n3@x.y", Some("selfy")).await;
    call(&app, "POST", "/comments", Some(&me),
        Some(serde_json::json!({ "id": "b1", "body": "talking to @selfy" }))).await;

    let (_, inbox) = call(&app, "GET", "/notifications", Some(&me), None).await;
    assert_eq!(inbox["unread"], 0);
}

#[tokio::test]
async fn a_mention_reaches_the_person_named() {
    let app = router(test_state());
    let a = account(&app, "n4@x.y", Some("mentioner")).await;
    let b = account(&app, "n5@x.y", Some("mentioned")).await;

    call(&app, "POST", "/comments", Some(&a),
        Some(serde_json::json!({ "id": "b2", "body": "ask @mentioned about it" }))).await;

    let (_, inbox) = call(&app, "GET", "/notifications", Some(&b), None).await;
    assert_eq!(inbox["unread"], 1);
    assert_eq!(inbox["notifications"][0]["kind"], "mention");
}

// Otherwise @-mentioning is simply the way around a block.
#[tokio::test]
async fn a_blocked_person_cannot_reach_your_inbox_by_mentioning_you() {
    let app = router(test_state());
    let pest = account(&app, "n6@x.y", Some("thepest")).await;
    let victim = account(&app, "n7@x.y", Some("thevictim")).await;

    call(&app, "POST", "/blocks", Some(&victim),
        Some(serde_json::json!({ "handle": "thepest", "blocking": true }))).await;
    call(&app, "POST", "/comments", Some(&pest),
        Some(serde_json::json!({ "id": "b3", "body": "hey @thevictim" }))).await;

    let (_, inbox) = call(&app, "GET", "/notifications", Some(&victim), None).await;
    assert_eq!(inbox["unread"], 0);
}

#[tokio::test]
async fn a_reply_notifies_the_topic_author() {
    let app = router(test_state());
    let author = account(&app, "n8@x.y", Some("topicauthor")).await;
    let replier = account(&app, "n9@x.y", Some("thereplier")).await;

    let (_, t) = call(&app, "POST", "/topics", Some(&author),
        Some(serde_json::json!({ "title": "a question", "body": "anyone?" }))).await;
    let id = t["id"].as_i64().unwrap();
    call(&app, "POST", "/topics/replies", Some(&replier),
        Some(serde_json::json!({ "topicId": id, "body": "an answer" }))).await;

    let (_, inbox) = call(&app, "GET", "/notifications", Some(&author), None).await;
    assert_eq!(inbox["notifications"][0]["kind"], "reply");
    assert_eq!(inbox["notifications"][0]["actor"], "thereplier");
}

#[tokio::test]
async fn marking_read_clears_the_badge_and_only_your_own() {
    let app = router(test_state());
    let a = account(&app, "n10@x.y", Some("reader1")).await;
    let b = account(&app, "n11@x.y", Some("reader2")).await;
    let c = account(&app, "n12@x.y", Some("actor1")).await;

    call(&app, "POST", "/follows", Some(&c), Some(serde_json::json!({ "handle": "reader1" }))).await;
    call(&app, "POST", "/follows", Some(&c), Some(serde_json::json!({ "handle": "reader2" }))).await;

    let (_, mine) = call(&app, "GET", "/notifications", Some(&a), None).await;
    let id = mine["notifications"][0]["id"].as_i64().unwrap();

    // Somebody else's id must not be markable.
    call(&app, "POST", "/notifications/read", Some(&b), Some(serde_json::json!({ "id": id }))).await;
    let (_, still) = call(&app, "GET", "/notifications", Some(&a), None).await;
    assert_eq!(still["unread"], 1, "another user cannot mark your notification read");

    call(&app, "POST", "/notifications/read", Some(&a), Some(serde_json::json!({}))).await;
    let (_, after) = call(&app, "GET", "/notifications", Some(&a), None).await;
    assert_eq!(after["unread"], 0);
}

// ── retracting your own words ───────────────────────────────────────────────

#[tokio::test]
async fn you_can_delete_your_own_comment_but_not_anybody_elses() {
    let app = router(test_state());
    let mine = account(&app, "d1@x.y", Some("owner1")).await;
    let theirs = account(&app, "d2@x.y", Some("stranger1")).await;

    call(&app, "POST", "/comments", Some(&mine),
        Some(serde_json::json!({ "id": "bd", "body": "oops my email" }))).await;
    let (_, list) = call(&app, "GET", "/comments?id=bd", Some(&mine), None).await;
    let id = list["comments"][0]["id"].as_i64().unwrap();

    let (st, _) = call(&app, "DELETE", "/comments/mine", Some(&theirs),
        Some(serde_json::json!({ "id": id }))).await;
    assert_eq!(st, StatusCode::NOT_FOUND, "somebody else's comment is not yours to delete");

    let (st, _) = call(&app, "DELETE", "/comments/mine", Some(&mine),
        Some(serde_json::json!({ "id": id }))).await;
    assert_eq!(st, StatusCode::OK);

    let (_, after) = call(&app, "GET", "/comments?id=bd", Some(&mine), None).await;
    assert_eq!(after["comments"].as_array().unwrap().len(), 0, "gone, not hidden");
}

// ── queue hygiene ───────────────────────────────────────────────────────────

#[tokio::test]
async fn reporting_the_same_thing_twice_does_not_double_the_queue() {
    let app = router(test_state());
    let a = account(&app, "dr1@x.y", Some("doublereporter")).await;

    for _ in 0..3 {
        let (st, _) = call(&app, "POST", "/reports", Some(&a), Some(serde_json::json!({
            "targetKind": "comment", "targetId": "77", "reason": "spam",
        }))).await;
        assert_eq!(st, StatusCode::OK, "each attempt still reads as success");
    }

    let (_, queue) = call(&app, "GET", "/admin/reports", Some(ADMIN), None).await;
    let n = queue["reports"].as_array().unwrap().iter()
        .filter(|r| r["targetId"] == "77").count();
    assert_eq!(n, 1, "one open report per person per target");
}

// A block covers following, not just what you see.
#[tokio::test]
async fn a_blocked_person_cannot_follow_you() {
    let app = router(test_state());
    let pest = account(&app, "bf1@x.y", Some("blockedpest")).await;
    let victim = account(&app, "bf2@x.y", Some("blockingone")).await;

    call(&app, "POST", "/blocks", Some(&victim),
        Some(serde_json::json!({ "handle": "blockedpest", "blocking": true }))).await;

    let (st, _) = call(&app, "POST", "/follows", Some(&pest),
        Some(serde_json::json!({ "handle": "blockingone" }))).await;
    assert_eq!(st, StatusCode::FORBIDDEN);
}

// ── forum search ────────────────────────────────────────────────────────────

#[tokio::test]
async fn the_forum_is_searchable_over_title_and_body() {
    let app = router(test_state());
    let a = account(&app, "fs1@x.y", Some("searcher")).await;
    call(&app, "POST", "/topics", Some(&a),
        Some(serde_json::json!({ "title": "Weather tile ideas", "body": "radar please" }))).await;
    call(&app, "POST", "/topics", Some(&a),
        Some(serde_json::json!({ "title": "Something else", "body": "unrelated" }))).await;

    let (_, by_title) = call(&app, "GET", "/topics?q=weather", None, None).await;
    assert_eq!(by_title["topics"].as_array().unwrap().len(), 1);

    let (_, by_body) = call(&app, "GET", "/topics?q=radar", None, None).await;
    assert_eq!(by_body["topics"].as_array().unwrap().len(), 1);

    let (_, all) = call(&app, "GET", "/topics", None, None).await;
    assert_eq!(all["topics"].as_array().unwrap().len(), 2, "no query means everything");
}


// A changed picture must appear immediately everywhere, not in five minutes.
// The first version cached for 300s and only ONE panel appended a
// cache-busting query, so every other surface showed a stale face and it read
// as a broken upload.
#[tokio::test]
async fn a_changed_avatar_is_served_immediately_and_an_unchanged_one_revalidates() {
    use axum::body::Body;
    use axum::http::{header, Request};

    let app = router(test_state());
    let me = account(&app, "etag@x.y", Some("etaguser")).await;

    fn png_of(fill: u8) -> String {
        use base64::Engine;
        let mut v = vec![0x89u8, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        v.extend_from_slice(&[fill; 64]);
        base64::engine::general_purpose::STANDARD.encode(&v)
    }

    async fn get_avatar(app: &axum::Router, inm: Option<&str>) -> (StatusCode, Option<String>) {
        let mut req = Request::builder().method("GET").uri("/creators/etaguser/avatar");
        if let Some(v) = inm {
            req = req.header(header::IF_NONE_MATCH, v);
        }
        let res = app.clone().oneshot(req.body(Body::empty()).unwrap()).await.unwrap();
        let status = res.status();
        let etag = res
            .headers()
            .get(header::ETAG)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());
        (status, etag)
    }

    call(&app, "POST", "/account/avatar", Some(&me),
        Some(serde_json::json!({ "image": png_of(1) }))).await;
    let (st, first) = get_avatar(&app, None).await;
    assert_eq!(st, StatusCode::OK);
    let first = first.expect("an ETag so the client can revalidate");

    // Unchanged: 304, no body. A page of avatars costs one of these each.
    let (st, _) = get_avatar(&app, Some(&first)).await;
    assert_eq!(st, StatusCode::NOT_MODIFIED);

    // Changed: the SAME conditional request must now return the new bytes,
    // which is the whole bug.
    call(&app, "POST", "/account/avatar", Some(&me),
        Some(serde_json::json!({ "image": png_of(2) }))).await;
    let (st, second) = get_avatar(&app, Some(&first)).await;
    assert_eq!(st, StatusCode::OK, "a new picture must not wait for a cache to expire");
    assert_ne!(second.unwrap(), first, "and it gets a new ETag");
}
