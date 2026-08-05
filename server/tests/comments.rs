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

async fn account(app: &axum::Router, email: &str, handle: &str) -> String {
    let (_, body) = call(app, "POST", "/auth/register", None,
        Some(serde_json::json!({ "email": email, "password": "hunter22222" }))).await;
    let verify = body["verify_token"].as_str().unwrap().to_string();
    call(app, "GET", &format!("/auth/verify?token={verify}"), None, None).await;
    let (_, body) = call(app, "POST", "/auth/login", None,
        Some(serde_json::json!({ "email": email, "password": "hunter22222" }))).await;
    let token = body["token"].as_str().unwrap().to_string();
    call(app, "POST", "/account/handle", Some(&token),
        Some(serde_json::json!({ "handle": handle }))).await;
    token
}

#[tokio::test]
async fn posting_and_reading_a_comment() {
    let app = router(test_state());
    let a = account(&app, "c1@x.y", "commenter").await;

    let (st, _) = call(&app, "POST", "/comments", Some(&a),
        Some(serde_json::json!({ "id": "some-viz", "body": "Works nicely on a 1440p panel." }))).await;
    assert_eq!(st, StatusCode::OK);

    let (st, body) = call(&app, "GET", "/comments?id=some-viz", None, None).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(body["comments"][0]["body"], "Works nicely on a 1440p panel.");
    assert_eq!(body["comments"][0]["handle"], "commenter");
}

// Same rule publishing follows: every visible contribution carries a name.
#[tokio::test]
async fn commenting_requires_a_handle() {
    let app = router(test_state());
    let (_, body) = call(&app, "POST", "/auth/register", None,
        Some(serde_json::json!({ "email": "nohandle@x.y", "password": "hunter22222" }))).await;
    let verify = body["verify_token"].as_str().unwrap().to_string();
    call(&app, "GET", &format!("/auth/verify?token={verify}"), None, None).await;
    let (_, body) = call(&app, "POST", "/auth/login", None,
        Some(serde_json::json!({ "email": "nohandle@x.y", "password": "hunter22222" }))).await;
    let t = body["token"].as_str().unwrap().to_string();

    let (st, _) = call(&app, "POST", "/comments", Some(&t),
        Some(serde_json::json!({ "id": "x", "body": "hi" }))).await;
    assert_eq!(st, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn blank_and_oversize_comments_are_rejected() {
    let app = router(test_state());
    let a = account(&app, "c2@x.y", "sizer").await;

    let (st, _) = call(&app, "POST", "/comments", Some(&a),
        Some(serde_json::json!({ "id": "x", "body": "   " }))).await;
    assert_eq!(st, StatusCode::BAD_REQUEST);

    let (st, _) = call(&app, "POST", "/comments", Some(&a),
        Some(serde_json::json!({ "id": "x", "body": "y".repeat(1001) }))).await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
}

// Plain text is the whole XSS story: the body comes back byte-for-byte and
// the client renders it as text, so there is nothing to escape or sanitise.
#[tokio::test]
async fn a_comment_body_is_stored_verbatim_not_interpreted() {
    let app = router(test_state());
    let a = account(&app, "c3@x.y", "markup").await;
    let nasty = "<script>alert(1)</script> **not bold** https://example.com";
    call(&app, "POST", "/comments", Some(&a),
        Some(serde_json::json!({ "id": "x", "body": nasty }))).await;

    let (_, body) = call(&app, "GET", "/comments?id=x", None, None).await;
    assert_eq!(body["comments"][0]["body"], nasty);
}

// Enforced server-side so a modified client cannot bypass it.
#[tokio::test]
async fn a_blocked_creators_comments_disappear_for_the_blocker_only() {
    let app = router(test_state());
    let loud = account(&app, "loud@x.y", "loudmouth").await;
    let quiet = account(&app, "quiet@x.y", "quietone").await;

    call(&app, "POST", "/comments", Some(&loud),
        Some(serde_json::json!({ "id": "shared", "body": "something annoying" }))).await;

    // Visible to everyone at first.
    let (_, before) = call(&app, "GET", "/comments?id=shared", Some(&quiet), None).await;
    assert_eq!(before["comments"].as_array().unwrap().len(), 1);

    let (st, _) = call(&app, "POST", "/blocks", Some(&quiet),
        Some(serde_json::json!({ "handle": "loudmouth", "blocking": true }))).await;
    assert_eq!(st, StatusCode::OK);

    let (_, after) = call(&app, "GET", "/comments?id=shared", Some(&quiet), None).await;
    assert_eq!(after["comments"].as_array().unwrap().len(), 0, "blocked for the blocker");

    let (_, others) = call(&app, "GET", "/comments?id=shared", Some(&loud), None).await;
    assert_eq!(others["comments"].as_array().unwrap().len(), 1, "and only for them");
}

#[tokio::test]
async fn reporting_then_hiding_removes_a_comment_for_everyone() {
    let app = router(test_state());
    let author = account(&app, "r1@x.y", "reported").await;
    let reporter = account(&app, "r2@x.y", "reporter").await;

    call(&app, "POST", "/comments", Some(&author),
        Some(serde_json::json!({ "id": "b", "body": "abuse" }))).await;
    let (_, listed) = call(&app, "GET", "/comments?id=b", None, None).await;
    let cid = listed["comments"][0]["id"].as_i64().unwrap();

    let (st, _) = call(&app, "POST", "/reports", Some(&reporter), Some(serde_json::json!({
        "targetKind": "comment", "targetId": cid.to_string(), "reason": "abusive"
    }))).await;
    assert_eq!(st, StatusCode::OK);

    let (st, queue) = call(&app, "GET", "/admin/reports", Some("test-admin"), None).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(queue["reports"][0]["targetKind"], "comment");
    assert_eq!(queue["reports"][0]["reportedBy"], "reporter",
        "a report is never anonymous, so someone filing hundreds is visible");

    let (st, _) = call(&app, "POST", "/admin/moderate", Some("test-admin"),
        Some(serde_json::json!({ "action": "hide-comment", "id": cid }))).await;
    assert_eq!(st, StatusCode::OK);

    let (_, after) = call(&app, "GET", "/comments?id=b", None, None).await;
    assert_eq!(after["comments"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn the_report_queue_and_actions_require_the_admin_token() {
    let app = router(test_state());
    // 403, matching what require_admin_pub already returns for every other
    // /admin route -- not 401. Worth pinning so the moderation surface cannot
    // drift away from the rest of the admin API.
    let (st, _) = call(&app, "GET", "/admin/reports", None, None).await;
    assert_eq!(st, StatusCode::FORBIDDEN);
    let (st, _) = call(&app, "POST", "/admin/moderate", None,
        Some(serde_json::json!({ "action": "resolve", "id": 1 }))).await;
    assert_eq!(st, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn suspending_a_creator_hides_their_comments_and_blocks_posting() {
    let app = router(test_state());
    let bad = account(&app, "bad@x.y", "troublemaker").await;
    call(&app, "POST", "/comments", Some(&bad),
        Some(serde_json::json!({ "id": "z", "body": "still here" }))).await;

    let (st, _) = call(&app, "POST", "/admin/moderate", Some("test-admin"),
        Some(serde_json::json!({ "action": "suspend", "handle": "troublemaker" }))).await;
    assert_eq!(st, StatusCode::OK);

    let (_, after) = call(&app, "GET", "/comments?id=z", None, None).await;
    assert_eq!(after["comments"].as_array().unwrap().len(), 0, "their existing comments go too");

    let (st, _) = call(&app, "POST", "/comments", Some(&bad),
        Some(serde_json::json!({ "id": "z", "body": "again" }))).await;
    assert_eq!(st, StatusCode::FORBIDDEN);
}

// The only path that can change a handle: self-service renaming would let
// someone shed a reputation and would rot every link to their work.
#[tokio::test]
async fn an_admin_can_rename_a_handle() {
    let app = router(test_state());
    account(&app, "rn@x.y", "oldname").await;

    let (st, _) = call(&app, "POST", "/admin/moderate", Some("test-admin"), Some(serde_json::json!({
        "action": "rename-handle", "handle": "oldname", "newHandle": "newname"
    }))).await;
    assert_eq!(st, StatusCode::OK);

    let (st, _) = call(&app, "GET", "/creators/newname", None, None).await;
    assert_eq!(st, StatusCode::OK);
    let (st, _) = call(&app, "GET", "/creators/oldname", None, None).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn an_admin_rename_still_obeys_the_handle_rules() {
    let app = router(test_state());
    account(&app, "rr@x.y", "renameme").await;
    let (st, _) = call(&app, "POST", "/admin/moderate", Some("test-admin"), Some(serde_json::json!({
        "action": "rename-handle", "handle": "renameme", "newHandle": "admin"
    }))).await;
    assert_eq!(st, StatusCode::BAD_REQUEST, "reserved names stay reserved for admins too");
}

#[tokio::test]
async fn an_unknown_report_target_kind_is_rejected() {
    let app = router(test_state());
    let a = account(&app, "rk@x.y", "reportkind").await;
    let (st, _) = call(&app, "POST", "/reports", Some(&a), Some(serde_json::json!({
        "targetKind": "everything", "targetId": "x", "reason": "r"
    }))).await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
}
