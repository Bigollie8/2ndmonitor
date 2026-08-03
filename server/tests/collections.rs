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
    body["token"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn a_collection_round_trips_through_the_public_endpoint() {
    let app = router(test_state());

    let (status, _) = call(&app, "POST", "/admin/collections", Some("test-admin"),
        Some(serde_json::json!({
            "slug": "weather-station",
            "title": "Weather station",
            "blurb": "Everything for a weather dashboard.",
            "sort": 1,
            "items": ["radar", "pollen", "aurora"]
        }))).await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = call(&app, "GET", "/collections", None, None).await;
    assert_eq!(status, StatusCode::OK);
    let c = &body["collections"][0];
    assert_eq!(c["slug"], "weather-station");
    assert_eq!(c["title"], "Weather station");
    assert_eq!(c["items"], serde_json::json!(["radar", "pollen", "aurora"]),
        "item order must be preserved");
}

#[tokio::test]
async fn upserting_a_collection_replaces_its_items_wholesale() {
    let app = router(test_state());
    call(&app, "POST", "/admin/collections", Some("test-admin"),
        Some(serde_json::json!({"slug": "kit", "title": "Kit", "items": ["a", "b", "c"]}))).await;
    call(&app, "POST", "/admin/collections", Some("test-admin"),
        Some(serde_json::json!({"slug": "kit", "title": "Kit v2", "items": ["b"]}))).await;

    let (_, body) = call(&app, "GET", "/collections", None, None).await;
    let c = &body["collections"][0];
    assert_eq!(c["title"], "Kit v2");
    assert_eq!(c["items"], serde_json::json!(["b"]), "stale items must not linger");
}

#[tokio::test]
async fn collections_are_ordered_by_sort_then_slug() {
    let app = router(test_state());
    call(&app, "POST", "/admin/collections", Some("test-admin"),
        Some(serde_json::json!({"slug": "zeta", "title": "Z", "sort": 0, "items": []}))).await;
    call(&app, "POST", "/admin/collections", Some("test-admin"),
        Some(serde_json::json!({"slug": "alpha", "title": "A", "sort": 0, "items": []}))).await;
    call(&app, "POST", "/admin/collections", Some("test-admin"),
        Some(serde_json::json!({"slug": "first", "title": "F", "sort": -1, "items": []}))).await;

    let (_, body) = call(&app, "GET", "/collections", None, None).await;
    let slugs: Vec<&str> = body["collections"].as_array().unwrap().iter()
        .map(|c| c["slug"].as_str().unwrap()).collect();
    assert_eq!(slugs, vec!["first", "alpha", "zeta"]);
}

#[tokio::test]
async fn a_deleted_collection_disappears_with_its_items() {
    let app = router(test_state());
    call(&app, "POST", "/admin/collections", Some("test-admin"),
        Some(serde_json::json!({"slug": "temp", "title": "Temp", "items": ["a"]}))).await;

    let (status, _) = call(&app, "DELETE", "/admin/collections/temp", Some("test-admin"), None).await;
    assert_eq!(status, StatusCode::OK);

    let (_, body) = call(&app, "GET", "/collections", None, None).await;
    assert_eq!(body["collections"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn collection_writes_require_the_admin_token() {
    let app = router(test_state());
    let token = make_user(&app, "coll@example.com").await;

    let (status, _) = call(&app, "POST", "/admin/collections", Some(&token),
        Some(serde_json::json!({"slug": "nope", "title": "Nope", "items": []}))).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _) = call(&app, "DELETE", "/admin/collections/nope", None, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn a_slug_must_be_url_safe() {
    let app = router(test_state());
    let (status, _) = call(&app, "POST", "/admin/collections", Some("test-admin"),
        Some(serde_json::json!({"slug": "Not A Slug", "title": "X", "items": []}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn a_collection_requires_a_title_and_an_items_array() {
    let app = router(test_state());
    let (status, _) = call(&app, "POST", "/admin/collections", Some("test-admin"),
        Some(serde_json::json!({"slug": "untitled", "title": "  ", "items": []}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let (status, _) = call(&app, "POST", "/admin/collections", Some("test-admin"),
        Some(serde_json::json!({"slug": "noitems", "title": "X"}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}
