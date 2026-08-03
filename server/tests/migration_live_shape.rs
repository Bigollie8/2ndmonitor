use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use http_body_util::BodyExt;
// `build_state` and `router` are pub at the crate root (lib.rs). `Config` is
// NOT re-exported there -- lib.rs imports it privately with
// `use state::{AppState, Config}` -- so it must be reached through the module
// path.
use hub_marketplace::state::Config;
use hub_marketplace::{build_state, router};
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

/// Builds a database with the EXACT shape the live server had before Market v2
/// -- pre-existing approved rows, no new columns -- then boots the real router
/// against it and exercises the real routes.
///
/// The unit tests in db.rs check a synthetic table; this checks that the whole
/// request path still works after migrating a database that already holds
/// published bundles. This project has three recorded incidents where a check
/// that bypassed the real mechanism gave a false pass.
#[tokio::test]
async fn a_pre_market_v2_database_migrates_and_keeps_serving() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch(
        r#"
        CREATE TABLE users (
            id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL,
            verified INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
        );
        CREATE TABLE bundles (
            id TEXT NOT NULL, version TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL,
            author_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
            permissions TEXT NOT NULL DEFAULT '[]', manifest TEXT NOT NULL, code TEXT,
            sha256 TEXT, size INTEGER, zip BLOB, ai_report TEXT, review_note TEXT,
            downloads INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, preview BLOB,
            PRIMARY KEY (id, version)
        );
        INSERT INTO users (id, email, pass_hash, verified, created_at)
            VALUES (1, 'legacy@example.com', 'x', 1, 0);
        INSERT INTO bundles (id, version, kind, name, author_id, status, manifest, sha256, size, created_at)
            VALUES ('old-viz', '1.0.0', 'visualizer', 'Old Viz', 1, 'approved', '{}', 'deadbeef', 10, 100);
        "#,
    )
    .unwrap();

    // build_state runs db::init, which is where the migration happens.
    let app = router(build_state(Config::test(), conn, [7u8; 32]));

    let (status, idx) = call(&app, "GET", "/index.json", None, None).await;
    assert_eq!(status, StatusCode::OK);
    let b = idx["bundles"]
        .as_array()
        .unwrap()
        .iter()
        .find(|b| b["id"] == "old-viz")
        .expect("a pre-existing approved bundle must survive the migration")
        .clone();

    // Pre-existing values are untouched...
    assert_eq!(b["name"], "Old Viz");
    assert_eq!(b["sha256"], "deadbeef");
    assert_eq!(b["author"], "leg***");
    // ...and the new keys are present with honest empty values.
    assert!(b["summary"].is_null());
    assert_eq!(b["tags"], serde_json::json!([]));
    assert_eq!(b["featured"], false);
    assert_eq!(b["mediaCount"], 0);
    assert!(
        b["approvedAt"].is_null(),
        "a row approved before this column existed has no timestamp"
    );

    // And the admin PATCH can backfill it, which is the whole point.
    let (status, _) = call(&app, "PATCH", "/admin/bundles/old-viz/1.0.0", Some("test-admin"),
        Some(serde_json::json!({"summary": "Backfilled", "category": "scene"}))).await;
    assert_eq!(status, StatusCode::OK);

    let (_, idx) = call(&app, "GET", "/index.json", None, None).await;
    let b = idx["bundles"].as_array().unwrap().iter()
        .find(|b| b["id"] == "old-viz").unwrap();
    assert_eq!(b["summary"], "Backfilled");
    assert_eq!(b["category"], "scene");
    assert_eq!(b["sha256"], "deadbeef", "backfill must never touch the zip hash");
}
