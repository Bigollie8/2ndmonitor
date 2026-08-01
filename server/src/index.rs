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

pub async fn index_json(State(state): State<AppState>) -> Result<Response, StatusCode> {
    let bundles: Vec<Value> = {
        let db = state.db.lock();
        let mut stmt = db
            .prepare(
                "SELECT b.id, b.version, b.kind, b.name, b.permissions, b.sha256, b.size, b.downloads, u.email,
                        b.preview IS NOT NULL AS has_preview
                 FROM bundles b JOIN users u ON u.id = b.author_id
                 WHERE b.status = 'approved' ORDER BY b.id, b.created_at",
            )
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let rows: Vec<Value> = stmt
            .query_map([], |r| {
                let email: String = r.get(8)?;
                // Mask author email: "oliver@x.y" -> "oli***"
                let masked = format!("{}***", email.chars().take(3).collect::<String>());
                Ok(json!({
                    "id": r.get::<_, String>(0)?,
                    "version": r.get::<_, String>(1)?,
                    "kind": r.get::<_, String>(2)?,
                    "name": r.get::<_, String>(3)?,
                    "permissions": serde_json::from_str::<Value>(&r.get::<_, String>(4)?).unwrap_or(json!([])),
                    "sha256": r.get::<_, Option<String>>(5)?,
                    "size": r.get::<_, Option<i64>>(6)?,
                    "downloads": r.get::<_, i64>(7)?,
                    "author": masked,
                    "hasPreview": r.get::<_, bool>(9)?,
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
