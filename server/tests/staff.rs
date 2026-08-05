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

/// Posts a real comment and returns its id. The permission tests need
/// something that actually exists: asserting a hide "worked" against an empty
/// table is how the no-op-reports-success bug survived.
async fn a_comment(app: &axum::Router, token: &str) -> i64 {
    call(app, "POST", "/comments", Some(token),
        Some(serde_json::json!({ "id": "some-bundle", "body": "a comment" }))).await;
    let (_, body) = call(app, "GET", "/comments?id=some-bundle", Some(token), None).await;
    body["comments"][0]["id"].as_i64().expect("comment id")
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

    // Content: allowed. Against a comment that really exists, so this pins
    // the permission AND the action.
    let cid = a_comment(&app, &mod_token).await;
    let (st, _) = call(&app, "POST", "/admin/moderate", Some(&mod_token),
        Some(serde_json::json!({ "action": "hide-comment", "id": cid }))).await;
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

    let cid = a_comment(&app, &admin).await;
    for action in [
        serde_json::json!({ "action": "hide-comment", "id": cid }),
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


// ── the audit log ───────────────────────────────────────────────────────────

#[tokio::test]
async fn every_action_is_written_down_with_who_did_it() {
    let app = router(test_state());
    let admin = account(&app, "au1@x.y", "logger").await;
    account(&app, "au2@x.y", "logged").await;
    promote(&app, "logger", "admin").await;

    call(&app, "POST", "/admin/moderate", Some(&admin),
        Some(serde_json::json!({ "action": "suspend", "handle": "logged" }))).await;

    let (st, body) = call(&app, "GET", "/admin/audit", Some(&admin), None).await;
    assert_eq!(st, StatusCode::OK);
    let top = &body["entries"][0];
    assert_eq!(top["action"], "suspend");
    assert_eq!(top["actor"], "logger");
    assert_eq!(top["undoable"], true);
    assert!(top["undoneAt"].is_null());
}

// The shared token belongs to whoever holds it, so it has no name. The log
// says so rather than inventing one.
#[tokio::test]
async fn the_shared_token_is_logged_as_nameless() {
    let app = router(test_state());
    account(&app, "au3@x.y", "target3").await;
    call(&app, "POST", "/admin/moderate", Some(ADMIN),
        Some(serde_json::json!({ "action": "suspend", "handle": "target3" }))).await;

    let (_, body) = call(&app, "GET", "/admin/audit", Some(ADMIN), None).await;
    assert!(body["entries"][0]["actor"].is_null());
}

#[tokio::test]
async fn undoing_a_suspension_puts_the_creator_back() {
    let app = router(test_state());
    let admin = account(&app, "u1@x.y", "undoer").await;
    account(&app, "u2@x.y", "undone").await;
    promote(&app, "undoer", "admin").await;

    call(&app, "POST", "/admin/moderate", Some(&admin),
        Some(serde_json::json!({ "action": "suspend", "handle": "undone" }))).await;
    let (st, _) = call(&app, "GET", "/creators/undone", None, None).await;
    assert_eq!(st, StatusCode::NOT_FOUND, "suspended creators 404");

    let (_, log) = call(&app, "GET", "/admin/audit", Some(&admin), None).await;
    let entry = log["entries"].as_array().unwrap().iter()
        .find(|e| e["action"] == "suspend").unwrap();
    let id = entry["id"].as_i64().unwrap();

    let (st, res) = call(&app, "POST", "/admin/undo", Some(&admin),
        Some(serde_json::json!({ "id": id }))).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(res["applied"], "unsuspend");

    let (st, _) = call(&app, "GET", "/creators/undone", None, None).await;
    assert_eq!(st, StatusCode::OK, "and they are back");
}

// set-role cannot be reversed from its arguments alone — only the audit row
// knows what the role WAS.
#[tokio::test]
async fn undoing_a_role_change_restores_the_previous_role() {
    let app = router(test_state());
    let admin = account(&app, "u3@x.y", "roleadmin").await;
    let subject = account(&app, "u4@x.y", "rolesubject").await;
    promote(&app, "roleadmin", "admin").await;
    promote(&app, "rolesubject", "moderator").await;

    call(&app, "POST", "/admin/moderate", Some(&admin),
        Some(serde_json::json!({ "action": "set-role", "handle": "rolesubject", "role": "admin" }))).await;
    let (_, who) = call(&app, "GET", "/admin/whoami", Some(&subject), None).await;
    assert_eq!(who["role"], "admin");

    let (_, log) = call(&app, "GET", "/admin/audit", Some(&admin), None).await;
    let id = log["entries"].as_array().unwrap().iter()
        .find(|e| e["action"] == "set-role" && e["args"]["role"] == "admin")
        .unwrap()["id"].as_i64().unwrap();

    let (st, _) = call(&app, "POST", "/admin/undo", Some(&admin),
        Some(serde_json::json!({ "id": id }))).await;
    assert_eq!(st, StatusCode::OK);

    let (_, who) = call(&app, "GET", "/admin/whoami", Some(&subject), None).await;
    assert_eq!(who["role"], "moderator", "restored to what it was, not to 'user'");
}

#[tokio::test]
async fn an_undo_cannot_be_applied_twice() {
    let app = router(test_state());
    let admin = account(&app, "u5@x.y", "twiceadmin").await;
    account(&app, "u6@x.y", "twicetarget").await;
    promote(&app, "twiceadmin", "admin").await;

    call(&app, "POST", "/admin/moderate", Some(&admin),
        Some(serde_json::json!({ "action": "suspend", "handle": "twicetarget" }))).await;
    let (_, log) = call(&app, "GET", "/admin/audit", Some(&admin), None).await;
    let id = log["entries"][0]["id"].as_i64().unwrap();

    let (st, _) = call(&app, "POST", "/admin/undo", Some(&admin), Some(serde_json::json!({ "id": id }))).await;
    assert_eq!(st, StatusCode::OK);
    let (st, _) = call(&app, "POST", "/admin/undo", Some(&admin), Some(serde_json::json!({ "id": id }))).await;
    assert_eq!(st, StatusCode::CONFLICT);
}

// A moderator can READ the whole log, but cannot undo an admin's action just
// because it appears in a list they can see.
#[tokio::test]
async fn a_moderator_cannot_undo_an_admin_action() {
    let app = router(test_state());
    let admin = account(&app, "u7@x.y", "bossadmin").await;
    let mod_token = account(&app, "u8@x.y", "justamod").await;
    account(&app, "u9@x.y", "poorsoul").await;
    promote(&app, "bossadmin", "admin").await;
    promote(&app, "justamod", "moderator").await;

    call(&app, "POST", "/admin/moderate", Some(&admin),
        Some(serde_json::json!({ "action": "suspend", "handle": "poorsoul" }))).await;

    let (st, log) = call(&app, "GET", "/admin/audit", Some(&mod_token), None).await;
    assert_eq!(st, StatusCode::OK, "moderators can read the whole log");
    let id = log["entries"].as_array().unwrap().iter()
        .find(|e| e["action"] == "suspend").unwrap()["id"].as_i64().unwrap();

    let (st, _) = call(&app, "POST", "/admin/undo", Some(&mod_token),
        Some(serde_json::json!({ "id": id }))).await;
    assert_eq!(st, StatusCode::FORBIDDEN);
}

// Removing a picture is undoable only because the bytes are moved aside
// rather than deleted.
#[tokio::test]
async fn a_removed_avatar_can_be_restored() {
    let app = router(test_state());
    let admin = account(&app, "av9@x.y", "picadmin").await;
    let owner = account(&app, "av8@x.y", "picowner").await;
    promote(&app, "picadmin", "admin").await;

    let png = {
        use base64::Engine;
        let mut v = vec![0x89u8, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        v.extend_from_slice(&[0u8; 32]);
        base64::engine::general_purpose::STANDARD.encode(&v)
    };
    call(&app, "POST", "/account/avatar", Some(&owner),
        Some(serde_json::json!({ "image": png }))).await;

    call(&app, "POST", "/admin/moderate", Some(&admin),
        Some(serde_json::json!({ "action": "remove-avatar", "handle": "picowner" }))).await;
    let (st, _) = call(&app, "GET", "/creators/picowner/avatar", None, None).await;
    assert_eq!(st, StatusCode::NOT_FOUND);

    let (_, log) = call(&app, "GET", "/admin/audit", Some(&admin), None).await;
    let id = log["entries"].as_array().unwrap().iter()
        .find(|e| e["action"] == "remove-avatar").unwrap()["id"].as_i64().unwrap();

    let (st, _) = call(&app, "POST", "/admin/undo", Some(&admin), Some(serde_json::json!({ "id": id }))).await;
    assert_eq!(st, StatusCode::OK);
    let (st, _) = call(&app, "GET", "/creators/picowner/avatar", None, None).await;
    assert_eq!(st, StatusCode::OK, "the bytes were set aside, not deleted");
}

// The undo is itself an action, so the history reads forwards.
#[tokio::test]
async fn the_undo_is_logged_too() {
    let app = router(test_state());
    let admin = account(&app, "l1@x.y", "historian").await;
    account(&app, "l2@x.y", "subject1").await;
    promote(&app, "historian", "admin").await;

    call(&app, "POST", "/admin/moderate", Some(&admin),
        Some(serde_json::json!({ "action": "suspend", "handle": "subject1" }))).await;
    let (_, log) = call(&app, "GET", "/admin/audit", Some(&admin), None).await;
    let id = log["entries"][0]["id"].as_i64().unwrap();
    call(&app, "POST", "/admin/undo", Some(&admin), Some(serde_json::json!({ "id": id }))).await;

    let (_, after) = call(&app, "GET", "/admin/audit", Some(&admin), None).await;
    assert_eq!(after["entries"][0]["action"], "unsuspend", "the undo appears as its own entry");
    let original = after["entries"].as_array().unwrap().iter()
        .find(|e| e["id"] == id).unwrap();
    assert!(!original["undoneAt"].is_null(), "and the original is marked");
    assert_eq!(original["undoneBy"], "historian");
}


// ── invites ─────────────────────────────────────────────────────────────────

async fn make_invite(app: &axum::Router, token: &str, max_uses: i64) -> String {
    let (st, body) = call(app, "POST", "/admin/invites", Some(token),
        Some(serde_json::json!({ "note": "test", "maxUses": max_uses }))).await;
    assert_eq!(st, StatusCode::OK, "creating an invite");
    body["code"].as_str().unwrap().to_string()
}

// The whole point: somebody can get an account with NO mail relay configured.
#[tokio::test]
async fn an_invite_creates_a_verified_account_without_any_email() {
    let app = router(test_state());
    let code = make_invite(&app, ADMIN, 1).await;

    let (st, body) = call(&app, "POST", "/auth/register", None, Some(serde_json::json!({
        "email": "invited@x.y", "password": "hunter22222", "invite": code,
    }))).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(body["verified"], true, "the code IS the proof — nothing left to confirm");

    // And they can sign in immediately, with no verification step.
    let (st, login) = call(&app, "POST", "/auth/login", None, Some(serde_json::json!({
        "email": "invited@x.y", "password": "hunter22222",
    }))).await;
    assert_eq!(st, StatusCode::OK);
    assert!(login["token"].as_str().is_some());
}

#[tokio::test]
async fn a_single_use_code_cannot_be_spent_twice() {
    let app = router(test_state());
    let code = make_invite(&app, ADMIN, 1).await;

    let (st, _) = call(&app, "POST", "/auth/register", None, Some(serde_json::json!({
        "email": "first@x.y", "password": "hunter22222", "invite": code.clone(),
    }))).await;
    assert_eq!(st, StatusCode::OK);

    let (st, _) = call(&app, "POST", "/auth/register", None, Some(serde_json::json!({
        "email": "second@x.y", "password": "hunter22222", "invite": code,
    }))).await;
    assert_eq!(st, StatusCode::FORBIDDEN, "the second attempt must be refused");
}

#[tokio::test]
async fn a_multi_use_code_admits_exactly_its_allowance() {
    let app = router(test_state());
    let code = make_invite(&app, ADMIN, 2).await;

    for who in ["a@x.y", "b@x.y"] {
        let (st, _) = call(&app, "POST", "/auth/register", None, Some(serde_json::json!({
            "email": who, "password": "hunter22222", "invite": code.clone(),
        }))).await;
        assert_eq!(st, StatusCode::OK, "{who}");
    }
    let (st, _) = call(&app, "POST", "/auth/register", None, Some(serde_json::json!({
        "email": "c@x.y", "password": "hunter22222", "invite": code,
    }))).await;
    assert_eq!(st, StatusCode::FORBIDDEN, "the third is one too many");
}

// Typed from a screenshot, read aloud, pasted from chat — all must work.
#[tokio::test]
async fn a_code_is_accepted_however_it_was_typed() {
    let app = router(test_state());
    let code = make_invite(&app, ADMIN, 1).await;
    let mangled = code.to_lowercase().replace('-', " ");

    let (st, _) = call(&app, "POST", "/auth/register", None, Some(serde_json::json!({
        "email": "mangled@x.y", "password": "hunter22222", "invite": mangled,
    }))).await;
    assert_eq!(st, StatusCode::OK);
}

#[tokio::test]
async fn a_bad_or_revoked_code_is_refused_and_leaves_no_account_behind() {
    let app = router(test_state());

    let (st, _) = call(&app, "POST", "/auth/register", None, Some(serde_json::json!({
        "email": "nope@x.y", "password": "hunter22222", "invite": "ZZZZ-ZZZZ-ZZZZ",
    }))).await;
    assert_eq!(st, StatusCode::FORBIDDEN);

    // The address must still be free — a rejected attempt that left a row
    // behind would lock it out forever, since email is UNIQUE.
    let code = make_invite(&app, ADMIN, 1).await;
    let (st, _) = call(&app, "POST", "/auth/register", None, Some(serde_json::json!({
        "email": "nope@x.y", "password": "hunter22222", "invite": code,
    }))).await;
    assert_eq!(st, StatusCode::OK, "a failed redemption must not consume the address");

    let revokable = make_invite(&app, ADMIN, 1).await;
    call(&app, "POST", "/admin/moderate", Some(ADMIN),
        Some(serde_json::json!({ "action": "revoke-invite", "code": revokable.clone() }))).await;
    let (st, _) = call(&app, "POST", "/auth/register", None, Some(serde_json::json!({
        "email": "revoked@x.y", "password": "hunter22222", "invite": revokable,
    }))).await;
    assert_eq!(st, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn invites_are_staff_only_to_mint_and_to_read() {
    let app = router(test_state());
    let nobody = account(&app, "inv1@x.y", "nobodyhere").await;

    let (st, _) = call(&app, "POST", "/admin/invites", Some(&nobody),
        Some(serde_json::json!({ "maxUses": 99 }))).await;
    assert_eq!(st, StatusCode::FORBIDDEN);
    let (st, _) = call(&app, "GET", "/admin/invites", Some(&nobody), None).await;
    assert_eq!(st, StatusCode::FORBIDDEN);
}

// ── admin password reset ────────────────────────────────────────────────────

#[tokio::test]
async fn an_admin_can_reset_a_password_and_it_kills_the_old_sessions() {
    let app = router(test_state());
    let admin = account(&app, "pw1@x.y", "pwadmin").await;
    let victim = account(&app, "pw2@x.y", "forgetful").await;
    call(&app, "POST", "/admin/moderate", Some(ADMIN),
        Some(serde_json::json!({ "action": "set-role", "handle": "pwadmin", "role": "admin" }))).await;

    // Their existing session works right now.
    let (st, _) = call(&app, "GET", "/account", Some(&victim), None).await;
    assert_eq!(st, StatusCode::OK);

    let (st, _) = call(&app, "POST", "/admin/moderate", Some(&admin), Some(serde_json::json!({
        "action": "set-password", "handle": "forgetful", "password": "temporary123",
    }))).await;
    assert_eq!(st, StatusCode::OK);

    // A reset that leaves the old session alive does not lock anybody out.
    let (st, _) = call(&app, "GET", "/account", Some(&victim), None).await;
    assert_eq!(st, StatusCode::UNAUTHORIZED, "the old session must die with the password");

    let (st, login) = call(&app, "POST", "/auth/login", None, Some(serde_json::json!({
        "email": "pw2@x.y", "password": "temporary123",
    }))).await;
    assert_eq!(st, StatusCode::OK, "and the new one works");
    assert!(login["token"].as_str().is_some());
}

#[tokio::test]
async fn a_password_reset_is_recorded_but_marked_unreversible() {
    let app = router(test_state());
    account(&app, "pw3@x.y", "logged2").await;
    call(&app, "POST", "/admin/moderate", Some(ADMIN), Some(serde_json::json!({
        "action": "set-password", "handle": "logged2", "password": "temporary123",
    }))).await;

    let (_, log) = call(&app, "GET", "/admin/audit", Some(ADMIN), None).await;
    let entry = log["entries"].as_array().unwrap().iter()
        .find(|e| e["action"] == "set-password").unwrap();
    // Storing the old hash to enable an undo would mean keeping a way back
    // into somebody's account long after the reset.
    assert_eq!(entry["undoable"], false);
}

#[tokio::test]
async fn a_moderator_cannot_reset_anybody_password() {
    let app = router(test_state());
    let mod_token = account(&app, "pw4@x.y", "justmod2").await;
    account(&app, "pw5@x.y", "target9").await;
    call(&app, "POST", "/admin/moderate", Some(ADMIN),
        Some(serde_json::json!({ "action": "set-role", "handle": "justmod2", "role": "moderator" }))).await;

    let (st, _) = call(&app, "POST", "/admin/moderate", Some(&mod_token), Some(serde_json::json!({
        "action": "set-password", "handle": "target9", "password": "temporary123",
    }))).await;
    assert_eq!(st, StatusCode::FORBIDDEN);
}
