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
    let mut req = Request::builder().method(method).uri(uri).header("x-forwarded-for", "5.5.5.5");
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

const ADMIN: &str = "test-admin";

async fn promote(app: &axum::Router, handle: &str, role: &str) {
    let (st, _) = call(app, "POST", "/admin/moderate", Some(ADMIN),
        Some(serde_json::json!({ "action": "set-role", "handle": handle, "role": role }))).await;
    assert_eq!(st, StatusCode::OK, "promoting {handle} to {role}");
}

// ── the bootstrap path ──────────────────────────────────────────────────────

#[tokio::test]
async fn the_shared_token_still_works_so_deploy_scripts_do_not_break() {
    let app = router(test_state());
    account(&app, "s1@x.y", "someone").await;
    let (st, _) = call(&app, "GET", "/admin/users", Some(ADMIN), None).await;
    assert_eq!(st, StatusCode::OK);
}

#[tokio::test]
async fn an_ordinary_user_gets_nowhere_near_the_staff_surface() {
    let app = router(test_state());
    let nobody = account(&app, "s2@x.y", "nobody").await;

    for (method, uri) in [("GET", "/admin/users"), ("GET", "/admin/whoami"), ("GET", "/admin/reports")] {
        let (st, _) = call(&app, method, uri, Some(&nobody), None).await;
        assert_eq!(st, StatusCode::FORBIDDEN, "{uri}");
    }
    let (st, _) = call(&app, "POST", "/admin/moderate", Some(&nobody),
        Some(serde_json::json!({ "action": "hide-comment", "id": 1 }))).await;
    assert_eq!(st, StatusCode::FORBIDDEN);
}

// ── the two levels ──────────────────────────────────────────────────────────

#[tokio::test]
async fn a_moderator_handles_content_but_not_people() {
    let app = router(test_state());
    let mod_token = account(&app, "m1@x.y", "themod").await;
    account(&app, "v1@x.y", "victim").await;
    promote(&app, "themod", "moderator").await;

    // Content: allowed.
    let (st, _) = call(&app, "POST", "/admin/moderate", Some(&mod_token),
        Some(serde_json::json!({ "action": "hide-comment", "id": 1 }))).await;
    assert_eq!(st, StatusCode::OK);
    let (st, _) = call(&app, "GET", "/admin/reports", Some(&mod_token), None).await;
    assert_eq!(st, StatusCode::OK);

    // People and permissions: refused. These reach across everything somebody
    // has ever posted, so they need the higher bar.
    for action in [
        serde_json::json!({ "action": "suspend", "handle": "victim" }),
        serde_json::json!({ "action": "rename-handle", "handle": "victim", "newHandle": "renamed" }),
        serde_json::json!({ "action": "grant-badge", "handle": "victim", "badge": "staff" }),
        serde_json::json!({ "action": "set-role", "handle": "victim", "role": "admin" }),
    ] {
        let (st, _) = call(&app, "POST", "/admin/moderate", Some(&mod_token), Some(action.clone())).await;
        assert_eq!(st, StatusCode::FORBIDDEN, "{action}");
    }
}

// The escalation that matters most: a moderator must not be able to make
// themselves an admin.
#[tokio::test]
async fn a_moderator_cannot_promote_themselves() {
    let app = router(test_state());
    let mod_token = account(&app, "m2@x.y", "climber").await;
    promote(&app, "climber", "moderator").await;

    let (st, _) = call(&app, "POST", "/admin/moderate", Some(&mod_token),
        Some(serde_json::json!({ "action": "set-role", "handle": "climber", "role": "admin" }))).await;
    assert_eq!(st, StatusCode::FORBIDDEN);

    let (_, who) = call(&app, "GET", "/admin/whoami", Some(&mod_token), None).await;
    assert_eq!(who["role"], "moderator");
    assert_eq!(who["canManagePeople"], false);
}

#[tokio::test]
async fn an_admin_can_do_everything_a_moderator_can_and_more() {
    let app = router(test_state());
    let admin = account(&app, "a1@x.y", "theboss").await;
    account(&app, "v2@x.y", "target2").await;
    promote(&app, "theboss", "admin").await;

    let (_, who) = call(&app, "GET", "/admin/whoami", Some(&admin), None).await;
    assert_eq!(who["role"], "admin");
    assert_eq!(who["canManagePeople"], true);

    for action in [
        serde_json::json!({ "action": "hide-comment", "id": 1 }),
        serde_json::json!({ "action": "grant-badge", "handle": "target2", "badge": "verified" }),
        serde_json::json!({ "action": "suspend", "handle": "target2" }),
        serde_json::json!({ "action": "unsuspend", "handle": "target2" }),
        serde_json::json!({ "action": "set-role", "handle": "target2", "role": "moderator" }),
    ] {
        let (st, _) = call(&app, "POST", "/admin/moderate", Some(&admin), Some(action.clone())).await;
        assert_eq!(st, StatusCode::OK, "{action}");
    }
}

// A suspended moderator must not be able to moderate their way back out.
#[tokio::test]
async fn suspension_strips_privileges_immediately() {
    let app = router(test_state());
    let mod_token = account(&app, "m3@x.y", "suspendedmod").await;
    promote(&app, "suspendedmod", "moderator").await;

    let (st, _) = call(&app, "GET", "/admin/users", Some(&mod_token), None).await;
    assert_eq!(st, StatusCode::OK);

    call(&app, "POST", "/admin/moderate", Some(ADMIN),
        Some(serde_json::json!({ "action": "suspend", "handle": "suspendedmod" }))).await;

    let (st, _) = call(&app, "GET", "/admin/users", Some(&mod_token), None).await;
    assert_eq!(st, StatusCode::FORBIDDEN, "a suspended moderator has no privileges");
}

// Not paternalism: an admin who removes their own last privilege locks
// everyone out of the panel, and the only way back is the shared token on the
// server box.
#[tokio::test]
async fn an_admin_cannot_demote_themselves_but_another_admin_can() {
    let app = router(test_state());
    let a = account(&app, "a2@x.y", "adminone").await;
    let b = account(&app, "a3@x.y", "admintwo").await;
    promote(&app, "adminone", "admin").await;
    promote(&app, "admintwo", "admin").await;

    let (st, _) = call(&app, "POST", "/admin/moderate", Some(&a),
        Some(serde_json::json!({ "action": "set-role", "handle": "adminone", "role": "user" }))).await;
    assert_eq!(st, StatusCode::BAD_REQUEST);

    let (st, _) = call(&app, "POST", "/admin/moderate", Some(&b),
        Some(serde_json::json!({ "action": "set-role", "handle": "adminone", "role": "user" }))).await;
    assert_eq!(st, StatusCode::OK, "somebody else can always demote them");
}

// ── the user list ───────────────────────────────────────────────────────────

#[tokio::test]
async fn the_user_list_shows_everyone_including_accounts_with_no_handle() {
    let state = test_state();
    {
        let db = state.db.lock();
        db.execute("INSERT INTO users (id,email,pass_hash,verified,created_at) VALUES (90,'lurker@x.y','h',1,10)", []).unwrap();
    }
    let app = router(state);
    account(&app, "listed@x.y", "listeduser").await;

    let (st, body) = call(&app, "GET", "/admin/users", Some(ADMIN), None).await;
    assert_eq!(st, StatusCode::OK);
    let users = body["users"].as_array().unwrap();
    assert!(users.len() >= 2, "the public directory hides handle-less accounts; this must not");
    assert!(users.iter().any(|u| u["handle"].is_null()));
}

#[tokio::test]
async fn emails_are_masked_for_staff_too() {
    let app = router(test_state());
    account(&app, "private@x.y", "masked").await;
    let (_, body) = call(&app, "GET", "/admin/users", Some(ADMIN), None).await;
    let u = body["users"].as_array().unwrap().iter()
        .find(|u| u["handle"] == "masked").unwrap();
    assert_eq!(u["email"], "pri***", "a moderator needs to tell accounts apart, not read inboxes");
}

#[tokio::test]
async fn the_user_list_is_searchable_by_handle_and_email() {
    let app = router(test_state());
    account(&app, "findme@x.y", "findable").await;
    account(&app, "other@x.y", "otherperson").await;

    let (_, by_handle) = call(&app, "GET", "/admin/users?q=findab", Some(ADMIN), None).await;
    assert_eq!(by_handle["users"].as_array().unwrap().len(), 1);

    let (_, by_email) = call(&app, "GET", "/admin/users?q=findme", Some(ADMIN), None).await;
    assert_eq!(by_email["users"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn an_invalid_role_is_refused_rather_than_silently_becoming_user() {
    let app = router(test_state());
    account(&app, "r1@x.y", "roletest").await;
    let (st, _) = call(&app, "POST", "/admin/moderate", Some(ADMIN),
        Some(serde_json::json!({ "action": "set-role", "handle": "roletest", "role": "superuser" }))).await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
}
