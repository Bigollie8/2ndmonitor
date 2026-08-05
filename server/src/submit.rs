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
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::Write;

pub const CODE_MAX: usize = 262_144; // 256 KB
pub const PRESET_MAX: usize = 1_048_576; // 1 MiB
pub const PREVIEW_CAP: usize = 262_144; // 256 KiB — mirrors the app's PREVIEW_CAP

/// Same rule as the app's `sniff_image`: identify an image by its magic
/// number only, never by a caller-declared content type. Shared by
/// `validate_preview` below (submission time) and `index::preview`
/// (serving time) so there is exactly one place that decides what counts as
/// a PNG or JPEG — a second copy could quietly drift and accept at serve
/// time what was rejected at submit time, or vice versa.
pub fn sniff_image(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() >= 8 && bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Some("image/png");
    }
    if bytes.len() >= 3 && bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("image/jpeg");
    }
    None
}

/// Accept a preview on its magic number only, never on a caller-declared
/// content type — there isn't even a content-type header here, just base64
/// in a JSON field, and trusting a submitter's say-so about the bytes'
/// format is exactly the mistake `sniff_image` exists to avoid. Empty and
/// oversize previews are rejected explicitly so a bad submission fails with
/// a clear reason instead of silently storing zero/garbage bytes.
pub fn validate_preview(bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() {
        return Err("preview is empty".into());
    }
    if bytes.len() > PREVIEW_CAP {
        return Err(format!("preview too large ({} > {PREVIEW_CAP} bytes)", bytes.len()));
    }
    if sniff_image(bytes).is_none() {
        return Err("preview is not a PNG or JPEG".into());
    }
    Ok(())
}

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
    /// Optional catalog thumbnail, base64-encoded. Absent is valid — most
    /// submissions won't carry one, and the field must not become required.
    preview: Option<String>,
}

/// A layout payload is small by nature: a few dozen tiles, each a type and
/// four numbers.
const LAYOUT_MAX: usize = 64 * 1024;
const LAYOUT_MAX_TILES: usize = 64;

/// Structural validation of a published layout.
///
/// The client strips tile config before publishing (see
/// app/src/state/layoutPublish.ts), but the server cannot assume a real
/// client sent this — anyone can POST here. So the rule is enforced again on
/// this side: a tile object may carry EXACTLY `type` and `rect`, and anything
/// else is rejected rather than ignored. Ignoring it would let a
/// hand-crafted payload smuggle somebody's coordinates into the catalog.
fn validate_layout(v: &Value) -> Result<(), String> {
    let obj = v.as_object().ok_or("layout must be an object")?;
    if obj.get("v").and_then(Value::as_i64) != Some(1) {
        return Err("layout v must be 1".into());
    }
    for key in ["landscape", "portrait"] {
        let arr = obj
            .get(key)
            .and_then(Value::as_array)
            .ok_or_else(|| format!("layout {key} must be an array"))?;
        if arr.len() > LAYOUT_MAX_TILES {
            return Err(format!("layout {key} has more than {LAYOUT_MAX_TILES} tiles"));
        }
        for t in arr {
            let tile = t.as_object().ok_or("each tile must be an object")?;
            for k in tile.keys() {
                if k != "type" && k != "rect" {
                    return Err(format!("tile field {k:?} is not publishable"));
                }
            }
            let ty = tile.get("type").and_then(Value::as_str).unwrap_or("");
            if ty.is_empty() || ty.len() > 64 {
                return Err("tile type must be 1-64 characters".into());
            }
            let rect = tile.get("rect").and_then(Value::as_object).ok_or("tile rect required")?;
            for k in ["x", "y", "w", "h"] {
                let n = rect.get(k).and_then(Value::as_f64).ok_or_else(|| format!("rect {k} required"))?;
                if !n.is_finite() || !(0.0..=1.0).contains(&n) {
                    return Err(format!("rect {k} must be between 0 and 1"));
                }
            }
            if rect.len() != 4 {
                return Err("rect carries fields beyond x/y/w/h".into());
            }
        }
    }
    Ok(())
}

pub async fn submit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<SubmitBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let author_id = bearer_user(&state, &headers).map_err(|s| (s, "auth required".into()))?;

    // A handle is required to publish. Published work carries attribution on
    // every card and inside the signed index, and "oli***" is not attribution
    // — this requirement is what turns display_name from a column nothing
    // ever wrote into a real one.
    let handle: Option<String> = state
        .db
        .lock()
        .query_row("SELECT handle FROM users WHERE id = ?1", [author_id], |r| r.get(0))
        .unwrap_or(None);
    if handle.is_none() {
        return Err((
            StatusCode::FORBIDDEN,
            "choose a handle before publishing".into(),
        ));
    }

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
        "layout" => {
            // A layout is DATA, not code: an arrangement of tile types and
            // rects. It runs nothing, so there is no static check to make —
            // the validation that matters is structural, and it is what stops
            // a hand-crafted payload carrying config a real client stripped.
            let c = body.code.as_deref().ok_or((StatusCode::BAD_REQUEST, "code required".into()))?;
            if c.len() > LAYOUT_MAX {
                return Err((StatusCode::BAD_REQUEST, "layout too large".into()));
            }
            let parsed: Value = serde_json::from_str(c)
                .map_err(|e| (StatusCode::BAD_REQUEST, format!("layout invalid: {e}")))?;
            validate_layout(&parsed).map_err(|e| (StatusCode::BAD_REQUEST, e))?;
            ("layout.json", c.to_string())
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

    // Layouts auto-approve alongside presets: both are pure DATA with no code
    // to review, and structural validation is the entire review. A layout's
    // free text (name, summary) is moderated the same way a review's is —
    // report and hide — rather than by a queue nobody would keep up with.
    let auto_approve = body.kind == "preset" || body.kind == "layout";
    let (status, zip, sha, size) = if auto_approve {
        let (z, s, n) = zip_bundle(&body.manifest, payload_name, &payload);
        ("approved", Some(z), Some(s), Some(n))
    } else {
        ("pending", None, None, None)
    };

    // Preview images are stored on the row and served by the marketplace —
    // never bundled into the zip (see submit.rs / installer trust notes on
    // why the zip's payload set is fixed). No preview is a valid submission.
    let preview: Option<Vec<u8>> = match &body.preview {
        Some(b64) => {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(b64)
                .map_err(|e| (StatusCode::BAD_REQUEST, format!("preview is not valid base64: {e}")))?;
            validate_preview(&bytes).map_err(|e| (StatusCode::BAD_REQUEST, e))?;
            Some(bytes)
        }
        None => None,
    };

    let tags_json = serde_json::to_string(&validated.meta.tags).unwrap();
    // Presets auto-approve here rather than through admin `decide`, so this is
    // the only place their approval instant can be recorded. Every other kind
    // is stamped in `admin::decide`.
    let approved_at = if auto_approve { Some(now()) } else { None };

    {
        let db = state.db.lock();
        let inserted = db.execute(
            "INSERT OR IGNORE INTO bundles (id, version, kind, name, author_id, status, permissions, manifest, code, sha256, size, zip, created_at, preview,
                 summary, description, category, tags, icon, changelog, min_app_version, approved_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22)",
            rusqlite::params![
                validated.id, validated.version, body.kind, validated.name, author_id,
                status, perms_json, body.manifest,
                if body.kind == "preset" { None::<String> } else { Some(payload.clone()) },
                sha, size, zip, now(), preview,
                validated.meta.summary, validated.meta.description, validated.meta.category,
                tags_json, validated.meta.icon, validated.meta.changelog,
                validated.meta.min_app_version, approved_at
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_validation_accepts_png_rejects_oversize_and_non_image() {
        let png = [vec![0x89u8, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A], vec![0u8; 32]].concat();
        assert!(validate_preview(&png).is_ok());
        assert!(validate_preview(b"<html>not an image").is_err());
        assert!(validate_preview(&vec![0x89u8; PREVIEW_CAP + 1]).is_err());
        assert!(validate_preview(&[]).is_err());
    }
}
