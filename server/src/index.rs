//! Public marketplace surface: the signed index and bundle downloads.
//! The signature covers the exact serialized `bundles` array string that
//! appears in the response — the app re-serializes nothing, it verifies the
//! raw substring, so canonicalization is trivially stable.

use crate::db::now;
use crate::keys::{pubkey_hex, sign_hex};
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use serde_json::{json, Value};

/// Author display fallback when no `display_name` is set: the same masked email
/// the `author` field has always carried, so an author page has a title on day
/// one without a claim flow.
fn masked_display(email: &str) -> String {
    format!("{}***", email.chars().take(3).collect::<String>())
}

pub async fn index_json(State(state): State<AppState>) -> Result<Response, StatusCode> {
    let bundles: Vec<Value> = {
        let db = state.db.lock();
        let mut stmt = db
            .prepare(
                "SELECT b.id, b.version, b.kind, b.name, b.permissions, b.sha256, b.size, b.downloads, u.email,
                        b.preview IS NOT NULL AS has_preview_blob,
                        b.summary, b.description, b.category, b.tags, b.icon, b.changelog,
                        b.min_app_version, b.featured, b.approved_at, u.display_name,
                        (SELECT COUNT(*) FROM bundle_media m
                          WHERE m.bundle_id = b.id AND m.version = b.version) AS media_count
                 FROM bundles b JOIN users u ON u.id = b.author_id
                 WHERE b.status = 'approved' ORDER BY b.id, b.created_at",
            )
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let rows: Vec<Value> = stmt
            .query_map([], |r| {
                let email: String = r.get(8)?;
                // Mask author email: "oliver@x.y" -> "oli***"
                let masked = masked_display(&email);
                let display: Option<String> = r.get(19)?;
                let has_preview_blob: bool = r.get(9)?;
                let media_count: i64 = r.get(20)?;
                // `hasPreview` must stay true for the bundles published before
                // Market v2, whose image lives in the legacy `bundles.preview`
                // blob and not in `bundle_media`.
                let has_preview = has_preview_blob || media_count > 0;
                let tags: Value = serde_json::from_str::<Value>(&r.get::<_, String>(13)?)
                    .unwrap_or(json!([]));
                Ok(json!({
                    "id": r.get::<_, String>(0)?,
                    "version": r.get::<_, String>(1)?,
                    "kind": r.get::<_, String>(2)?,
                    "name": r.get::<_, String>(3)?,
                    "permissions": serde_json::from_str::<Value>(&r.get::<_, String>(4)?).unwrap_or(json!([])),
                    "sha256": r.get::<_, Option<String>>(5)?,
                    "size": r.get::<_, Option<i64>>(6)?,
                    "downloads": r.get::<_, i64>(7)?,
                    "author": masked.clone(),
                    "hasPreview": has_preview,
                    "summary": r.get::<_, Option<String>>(10)?,
                    "description": r.get::<_, Option<String>>(11)?,
                    "category": r.get::<_, Option<String>>(12)?,
                    "tags": tags,
                    "icon": r.get::<_, Option<String>>(14)?,
                    "changelog": r.get::<_, Option<String>>(15)?,
                    "minAppVersion": r.get::<_, Option<String>>(16)?,
                    "featured": r.get::<_, i64>(17)? != 0,
                    "approvedAt": r.get::<_, Option<i64>>(18)?,
                    "authorDisplay": display.unwrap_or(masked),
                    "mediaCount": media_count,
                }))
            })
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .filter_map(Result::ok)
            .collect();
        rows
    };

    // Serialize the array ONCE; sign that exact string; embed it verbatim.
    let bundles_str = serde_json::to_string(&bundles).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let sig = sign_hex(&state.signing_seed, bundles_str.as_bytes());
    let body = format!(
        r#"{{"generated_at":{},"bundles":{},"pubkey":"{}","sig":"{}"}}"#,
        now(),
        bundles_str,
        pubkey_hex(&state.signing_seed),
        sig
    );
    Ok((
        [(header::CONTENT_TYPE, "application/json")],
        body,
    )
        .into_response())
}

pub async fn preview(
    State(state): State<AppState>,
    Path((id, version)): Path<(String, String)>,
) -> Result<Response, StatusCode> {
    let bytes: Vec<u8> = state
        .db
        .lock()
        .query_row(
            "SELECT preview FROM bundles WHERE id = ?1 AND version = ?2 AND status = 'approved' AND preview IS NOT NULL",
            rusqlite::params![id, version],
            |r| r.get(0),
        )
        .map_err(|_| StatusCode::NOT_FOUND)?;
    let mime = crate::submit::sniff_image(&bytes).ok_or(StatusCode::NOT_FOUND)?;
    Ok(([(header::CONTENT_TYPE, mime)], bytes).into_response())
}

pub async fn download(
    State(state): State<AppState>,
    Path((id, version)): Path<(String, String)>,
) -> Result<Response, StatusCode> {
    let db = state.db.lock();
    let zip: Vec<u8> = db
        .query_row(
            "SELECT zip FROM bundles WHERE id = ?1 AND version = ?2 AND status = 'approved' AND zip IS NOT NULL",
            rusqlite::params![id, version],
            |r| r.get(0),
        )
        .map_err(|_| StatusCode::NOT_FOUND)?;
    let _ = db.execute(
        "UPDATE bundles SET downloads = downloads + 1 WHERE id = ?1 AND version = ?2",
        rusqlite::params![id, version],
    );
    Ok((
        [
            (header::CONTENT_TYPE, "application/zip".to_string()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{id}-{version}.zip\""),
            ),
        ],
        zip,
    )
        .into_response())
}
