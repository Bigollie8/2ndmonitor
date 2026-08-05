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
    let mut req = Request::builder().method(method).uri(uri).header("x-forwarded-for", "3.3.3.3");
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
async fn following_and_unfollowing_round_trip() {
    let app = router(test_state());
    let a = account(&app, "a@x.y", "alpha").await;
    account(&app, "b@x.y", "beta").await;

    let (st, _) = call(&app, "POST", "/follows", Some(&a),
        Some(serde_json::json!({ "handle": "beta", "following": true }))).await;
    assert_eq!(st, StatusCode::OK);

    let (_, s) = call(&app, "GET", "/follows?handle=beta", Some(&a), None).await;
    assert_eq!(s["followers"], 1);
    assert_eq!(s["following"], true);

    let (st, _) = call(&app, "POST", "/follows", Some(&a),
        Some(serde_json::json!({ "handle": "beta", "following": false }))).await;
    assert_eq!(st, StatusCode::OK);
    let (_, s) = call(&app, "GET", "/follows?handle=beta", Some(&a), None).await;
    assert_eq!(s["followers"], 0);
    assert_eq!(s["following"], false);
}

// A UI that got out of sync should converge rather than error.
#[tokio::test]
async fn following_twice_and_unfollowing_twice_are_both_fine() {
    let app = router(test_state());
    let a = account(&app, "a2@x.y", "alpha2").await;
    account(&app, "b2@x.y", "beta2").await;

    for _ in 0..2 {
        let (st, _) = call(&app, "POST", "/follows", Some(&a),
            Some(serde_json::json!({ "handle": "beta2", "following": true }))).await;
        assert_eq!(st, StatusCode::OK);
    }
    let (_, s) = call(&app, "GET", "/follows?handle=beta2", Some(&a), None).await;
    assert_eq!(s["followers"], 1, "following twice must not double-count");

    for _ in 0..2 {
        let (st, _) = call(&app, "POST", "/follows", Some(&a),
            Some(serde_json::json!({ "handle": "beta2", "following": false }))).await;
        assert_eq!(st, StatusCode::OK);
    }
}

#[tokio::test]
async fn you_cannot_follow_yourself() {
    let app = router(test_state());
    let a = account(&app, "self@x.y", "myself").await;
    let (st, _) = call(&app, "POST", "/follows", Some(&a),
        Some(serde_json::json!({ "handle": "myself" }))).await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
}

// The count is public so a signed-out browse still renders the button; only
// "am I following" needs a session.
#[tokio::test]
async fn follower_counts_are_readable_signed_out() {
    let app = router(test_state());
    let a = account(&app, "a3@x.y", "alpha3").await;
    account(&app, "b3@x.y", "beta3").await;
    call(&app, "POST", "/follows", Some(&a), Some(serde_json::json!({ "handle": "beta3" }))).await;

    let (st, s) = call(&app, "GET", "/follows?handle=beta3", None, None).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(s["followers"], 1);
    assert_eq!(s["following"], false, "no session means not following, not an error");
}

#[tokio::test]
async fn a_favourite_is_private_but_its_count_is_public() {
    let app = router(test_state());
    let a = account(&app, "fav@x.y", "favver").await;
    let b = account(&app, "other@x.y", "otherer").await;

    call(&app, "POST", "/favourites", Some(&a),
        Some(serde_json::json!({ "id": "cool-viz", "favourite": true }))).await;

    // The owner sees it in `mine`.
    let (_, own) = call(&app, "GET", "/favourites", Some(&a), None).await;
    assert_eq!(own["counts"]["cool-viz"], 1);
    assert_eq!(own["mine"][0], "cool-viz");

    // Somebody else sees the count but not that it was this person.
    let (_, theirs) = call(&app, "GET", "/favourites", Some(&b), None).await;
    assert_eq!(theirs["counts"]["cool-viz"], 1);
    assert_eq!(theirs["mine"].as_array().unwrap().len(), 0,
        "one user's favourites must never appear in another's list");
}

#[tokio::test]
async fn favouriting_is_idempotent_and_reversible() {
    let app = router(test_state());
    let a = account(&app, "idem@x.y", "idemuser").await;
    for _ in 0..3 {
        call(&app, "POST", "/favourites", Some(&a),
            Some(serde_json::json!({ "id": "x", "favourite": true }))).await;
    }
    let (_, s) = call(&app, "GET", "/favourites", Some(&a), None).await;
    assert_eq!(s["counts"]["x"], 1);

    call(&app, "POST", "/favourites", Some(&a),
        Some(serde_json::json!({ "id": "x", "favourite": false }))).await;
    let (_, s) = call(&app, "GET", "/favourites", Some(&a), None).await;
    assert!(s["counts"].get("x").is_none() || s["counts"]["x"] == 0);
}

#[tokio::test]
async fn the_feed_carries_ids_from_followed_creators_only() {
    let state = test_state();
    {
        let db = state.db.lock();
        db.execute("INSERT INTO users (id,email,pass_hash,verified,created_at,handle) VALUES (20,'p@x','h',1,0,'publisher')", []).unwrap();
        db.execute("INSERT INTO users (id,email,pass_hash,verified,created_at,handle) VALUES (21,'q@x','h',1,0,'stranger')", []).unwrap();
        db.execute(
            "INSERT INTO bundles (id,version,kind,name,author_id,status,manifest,sha256,size,created_at)
             VALUES ('followed-thing','1.0.0','visualizer','F',20,'approved','{}','a',1,200)", []).unwrap();
        db.execute(
            "INSERT INTO bundles (id,version,kind,name,author_id,status,manifest,sha256,size,created_at)
             VALUES ('unfollowed-thing','1.0.0','visualizer','U',21,'approved','{}','b',1,201)", []).unwrap();
    }
    let app = router(state);
    let me = account(&app, "me@x.y", "mefollower").await;
    call(&app, "POST", "/follows", Some(&me), Some(serde_json::json!({ "handle": "publisher" }))).await;

    let (st, feed) = call(&app, "GET", "/feed", Some(&me), None).await;
    assert_eq!(st, StatusCode::OK);
    let ids: Vec<&str> = feed["ids"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect();
    assert_eq!(ids, vec!["followed-thing"]);
}

#[tokio::test]
async fn the_feed_requires_a_session() {
    let app = router(test_state());
    let (st, _) = call(&app, "GET", "/feed", None, None).await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn following_an_unknown_creator_is_404() {
    let app = router(test_state());
    let a = account(&app, "nf@x.y", "nofollow").await;
    let (st, _) = call(&app, "POST", "/follows", Some(&a),
        Some(serde_json::json!({ "handle": "ghost" }))).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
}
