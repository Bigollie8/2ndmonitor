//! Submissions. Static checks run inline; presets auto-approve (validation is
//! the entire review for pure data); visualizers/tiles land in the pending
//! queue for the AI report + human decision.

use crate::auth::bearer_user;
use crate::db::now;
use crate::manifest::{validate, validate_view_spec, Perm};
use crate::state::AppState;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::Write;

pub const CODE_MAX: usize = 262_144; // 256 KB
pub const PRESET_MAX: usize = 1_048_576; // 1 MiB

/// Zip (manifest.json + main.js|preset.json) → (bytes, sha256 hex, size).
pub fn zip_bundle(manifest: &str, payload_name: &str, payload: &str) -> (Vec<u8>, String, i64) {
    let mut cursor = std::io::Cursor::new(Vec::new());
    {
        let mut zw = zip::ZipWriter::new(&mut cursor);
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        zw.start_file("manifest.json", opts).unwrap();
        zw.write_all(manifest.as_bytes()).unwrap();
        zw.start_file(payload_name, opts).unwrap();
        zw.write_all(payload.as_bytes()).unwrap();
        zw.finish().unwrap();
    }
    let bytes = cursor.into_inner();
    let sha = hex::encode(Sha256::digest(&bytes));
    let size = bytes.len() as i64;
    (bytes, sha, size)
}

fn static_check_code(code: &str) -> Result<(), String> {
    if code.len() > CODE_MAX {
        return Err(format!("code too large ({} > {CODE_MAX} bytes)", code.len()));
    }
    // Obfuscated-eval is exactly what the human queue is for; the static gate
    // just removes the trivially rejectable cases early.
    for needle in ["eval(", "new Function"] {
        if code.contains(needle) {
            return Err(format!("code contains disallowed pattern {needle:?}"));
        }
    }
    Ok(())
}

#[derive(Deserialize)]
pub struct SubmitBody {
    kind: String,
    manifest: String,
    code: Option<String>,
    preset_json: Option<String>,
}

pub async fn submit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<SubmitBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let author_id = bearer_user(&state, &headers).map_err(|s| (s, "auth required".into()))?;

    let validated = validate(&body.kind, &body.manifest)
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;

    let (payload_name, payload) = match body.kind.as_str() {
        "preset" => {
            let p = body.preset_json.as_deref().ok_or((StatusCode::BAD_REQUEST, "preset_json required".into()))?;
            if p.len() > PRESET_MAX {
                return Err((StatusCode::BAD_REQUEST, "preset too large".into()));
            }
            let parsed: Value = serde_json::from_str(p)
                .map_err(|e| (StatusCode::BAD_REQUEST, format!("preset_json invalid: {e}")))?;
            if !parsed.is_object() {
                return Err((StatusCode::BAD_REQUEST, "preset_json must be an object".into()));
            }
            ("preset.json", p.to_string())
        }
        "tile" => {
            let c = body.code.as_deref().ok_or((StatusCode::BAD_REQUEST, "code required".into()))?;
            static_check_code(c).map_err(|e| (StatusCode::BAD_REQUEST, e))?;
            validate_view_spec(c).map_err(|e| (StatusCode::BAD_REQUEST, e))?;
            ("view.json", c.to_string())
        }
        _ => {
            let c = body.code.as_deref().ok_or((StatusCode::BAD_REQUEST, "code required".into()))?;
            static_check_code(c).map_err(|e| (StatusCode::BAD_REQUEST, e))?;
            ("main.js", c.to_string())
        }
    };

    // The id namespace belongs to whoever published it first.
    let prior_author: Option<i64> = state
        .db
        .lock()
        .query_row(
            "SELECT author_id FROM bundles WHERE id = ?1 ORDER BY created_at LIMIT 1",
            [&validated.id],
            |r| r.get(0),
        )
        .ok();
    if let Some(owner) = prior_author {
        if owner != author_id {
            return Err((StatusCode::FORBIDDEN, format!("id {:?} belongs to another author", validated.id)));
        }
    }

    let perms_json = serde_json::to_string(
        &validated.permissions.iter().map(Perm::as_string).collect::<Vec<_>>(),
    ).unwrap();

    let auto_approve = body.kind == "preset";
    let (status, zip, sha, size) = if auto_approve {
        let (z, s, n) = zip_bundle(&body.manifest, payload_name, &payload);
        ("approved", Some(z), Some(s), Some(n))
    } else {
        ("pending", None, None, None)
    };

    {
        let db = state.db.lock();
        let inserted = db.execute(
            "INSERT OR IGNORE INTO bundles (id, version, kind, name, author_id, status, permissions, manifest, code, sha256, size, zip, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
            rusqlite::params![
                validated.id, validated.version, body.kind, validated.name, author_id,
                status, perms_json, body.manifest,
                if body.kind == "preset" { None::<String> } else { Some(payload.clone()) },
                sha, size, zip, now()
            ],
        ).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        if inserted == 0 {
            return Err((StatusCode::CONFLICT, "this id+version already exists".into()));
        }
    }

    // Advisory AI review for queued kinds (never blocks; see ai_review.rs).
    if !auto_approve {
        crate::ai_review::kick(&state, &validated.id, &validated.version);
    }

    Ok(Json(json!({ "id": validated.id, "version": validated.version, "status": status })))
}

pub async fn mine(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, StatusCode> {
    let author_id = bearer_user(&state, &headers)?;
    let db = state.db.lock();
    let mut stmt = db
        .prepare("SELECT id, version, kind, name, status, review_note, downloads FROM bundles WHERE author_id = ?1 ORDER BY created_at DESC")
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let rows = stmt
        .query_map([author_id], |r| {
            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "version": r.get::<_, String>(1)?,
                "kind": r.get::<_, String>(2)?,
                "name": r.get::<_, String>(3)?,
                "status": r.get::<_, String>(4)?,
                "review_note": r.get::<_, Option<String>>(5)?,
                "downloads": r.get::<_, i64>(6)?,
            }))
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();
    Ok(Json(json!({ "bundles": rows })))
}
