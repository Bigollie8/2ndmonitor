//! Admin review queue. Everything here requires `Authorization: Bearer
//! <ADMIN_TOKEN>`; when ADMIN_TOKEN is unconfigured the endpoints refuse —
//! there is no default credential. A human always clicks approve: the AI
//! report shown alongside each pending bundle is advisory only.

use crate::manifest::validate_meta;
use crate::state::AppState;
use crate::submit::zip_bundle;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Html;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

fn require_admin(state: &AppState, headers: &HeaderMap) -> Result<(), StatusCode> {
    let Some(expected) = state.cfg.admin_token.as_deref() else {
        return Err(StatusCode::FORBIDDEN);
    };
    let got = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    if got == Some(expected) {
        Ok(())
    } else {
        Err(StatusCode::FORBIDDEN)
    }
}

pub async fn queue(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, StatusCode> {
    require_admin(&state, &headers)?;
    let db = state.db.lock();
    let mut stmt = db
        .prepare(
            "SELECT b.id, b.version, b.kind, b.name, b.permissions, b.manifest, b.code, b.ai_report, u.email,
                    (SELECT code FROM bundles p WHERE p.id = b.id AND p.status = 'approved'
                     ORDER BY p.created_at DESC LIMIT 1) AS diff_base,
                    b.preview
             FROM bundles b JOIN users u ON u.id = b.author_id
             WHERE b.status = 'pending' ORDER BY b.created_at",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let rows = stmt
        .query_map([], |r| {
            // Rendered as a `data:` URL so a human approving the bundle sees
            // exactly the image that goes public the moment they click
            // approve — the preview endpoint only ever serves approved rows.
            let preview: Option<Vec<u8>> = r.get(10)?;
            let preview_data_url = preview.and_then(|bytes| {
                crate::submit::sniff_image(&bytes).map(|mime| {
                    use base64::Engine;
                    format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(&bytes))
                })
            });
            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "version": r.get::<_, String>(1)?,
                "kind": r.get::<_, String>(2)?,
                "name": r.get::<_, String>(3)?,
                "permissions": serde_json::from_str::<Value>(&r.get::<_, String>(4)?).unwrap_or(json!([])),
                "manifest": r.get::<_, String>(5)?,
                "code": r.get::<_, Option<String>>(6)?,
                "ai_report": r.get::<_, Option<String>>(7)?
                    .and_then(|s| serde_json::from_str::<Value>(&s).ok()),
                "author": r.get::<_, String>(8)?,
                "diff_base": r.get::<_, Option<String>>(9)?,
                "preview": preview_data_url,
            }))
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();
    Ok(Json(json!({ "pending": rows })))
}

#[derive(Deserialize)]
pub struct DecideBody {
    id: String,
    version: String,
    approve: bool,
    note: Option<String>,
}

pub async fn decide(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<DecideBody>,
) -> Result<Json<Value>, StatusCode> {
    require_admin(&state, &headers)?;
    let db = state.db.lock();
    let (manifest, code, kind, status): (String, Option<String>, String, String) = db
        .query_row(
            "SELECT manifest, code, kind, status FROM bundles WHERE id = ?1 AND version = ?2",
            rusqlite::params![body.id, body.version],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map_err(|_| StatusCode::NOT_FOUND)?;
    if status != "pending" {
        return Err(StatusCode::CONFLICT);
    }
    if body.approve {
        let payload_name = match kind.as_str() {
            "preset" => "preset.json",
            "tile" => "view.json",
            _ => "main.js",
        };
        let (zip, sha, size) = zip_bundle(&manifest, payload_name, code.as_deref().unwrap_or("{}"));
        // `created_at` is submit time; the store's New and Recently-updated
        // shelves need approval time, which is a different instant and can be
        // much later.
        db.execute(
            "UPDATE bundles SET status='approved', zip=?1, sha256=?2, size=?3, review_note=?4, approved_at=?5
             WHERE id=?6 AND version=?7",
            rusqlite::params![zip, sha, size, body.note, crate::db::now(), body.id, body.version],
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    } else {
        db.execute(
            "UPDATE bundles SET status='rejected', review_note=?1 WHERE id=?2 AND version=?3",
            rusqlite::params![body.note, body.id, body.version],
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    Ok(Json(json!({ "ok": true })))
}

/// Shared admin guard for the modules split out of this one (media,
/// collections, review moderation). Same rule as `require_admin`: no
/// ADMIN_TOKEN configured means every admin route refuses, with no default
/// credential.
pub fn require_admin_pub(state: &AppState, headers: &HeaderMap) -> Result<(), StatusCode> {
    require_admin(state, headers)
}

/// Admin metadata correction. This is how the bundles published before Market
/// v2 get real metadata: it writes ONLY descriptive columns, never `zip`,
/// `sha256`, `size` or `status`, so nothing is re-signed and no client
/// re-downloads anything.
///
/// Update semantics, chosen so a partial backfill run is safe to repeat: an
/// ABSENT key leaves the column untouched; a key set to `""` clears it to
/// NULL. Without the second rule there would be no way to undo a bad backfill
/// short of touching the database by hand.
pub async fn patch_bundle(
    State(state): State<AppState>,
    Path((id, version)): Path<(String, String)>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, String)> {
    require_admin(&state, &headers).map_err(|s| (s, "admin token required".to_string()))?;
    let obj = body
        .as_object()
        .ok_or((StatusCode::BAD_REQUEST, "body must be a JSON object".to_string()))?;

    let db = state.db.lock();
    let kind: String = db
        .query_row(
            "SELECT kind FROM bundles WHERE id = ?1 AND version = ?2",
            rusqlite::params![id, version],
            |r| r.get(0),
        )
        .map_err(|_| (StatusCode::NOT_FOUND, "no such bundle version".to_string()))?;

    // Validate exactly what a submission would have to satisfy, minus the
    // "must not be blank" rule — here a blank string is the documented
    // clear-to-NULL signal, so blanks are stripped out before validation and
    // applied as explicit NULLs afterwards.
    let mut to_clear: Vec<&str> = Vec::new();
    let mut to_validate = serde_json::Map::new();
    for key in ["summary", "description", "category", "tags", "icon", "changelog", "minAppVersion"] {
        match obj.get(key) {
            None => {}
            Some(Value::String(s)) if s.is_empty() => to_clear.push(key),
            Some(v) => {
                to_validate.insert(key.to_string(), v.clone());
            }
        }
    }
    let meta = validate_meta(&kind, &to_validate).map_err(|e| (StatusCode::BAD_REQUEST, e))?;

    let apply = |column: &str, value: Option<String>| -> Result<(), (StatusCode, String)> {
        db.execute(
            &format!("UPDATE bundles SET {column} = ?1 WHERE id = ?2 AND version = ?3"),
            rusqlite::params![value, id, version],
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        Ok(())
    };

    if to_validate.contains_key("summary") { apply("summary", meta.summary.clone())?; }
    if to_validate.contains_key("description") { apply("description", meta.description.clone())?; }
    if to_validate.contains_key("category") { apply("category", meta.category.clone())?; }
    if to_validate.contains_key("icon") { apply("icon", meta.icon.clone())?; }
    if to_validate.contains_key("changelog") { apply("changelog", meta.changelog.clone())?; }
    if to_validate.contains_key("minAppVersion") {
        apply("min_app_version", meta.min_app_version.clone())?;
    }
    if to_validate.contains_key("tags") {
        apply("tags", Some(serde_json::to_string(&meta.tags).unwrap()))?;
    }

    for key in to_clear {
        match key {
            // `tags` is NOT NULL; clearing it means the empty array, not NULL.
            "tags" => apply("tags", Some("[]".to_string()))?,
            "minAppVersion" => apply("min_app_version", None)?,
            other => apply(other, None)?,
        }
    }

    if let Some(f) = obj.get("featured") {
        let on = f
            .as_bool()
            .ok_or((StatusCode::BAD_REQUEST, "featured must be a boolean".to_string()))?;
        db.execute(
            "UPDATE bundles SET featured = ?1 WHERE id = ?2 AND version = ?3",
            rusqlite::params![if on { 1 } else { 0 }, id, version],
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    Ok(Json(json!({ "ok": true })))
}

/// Minimal single-file review UI. Token is pasted once and kept in
/// sessionStorage; all data flows through the JSON endpoints above.
pub async fn page() -> Html<&'static str> {
    Html(ADMIN_HTML)
}

const ADMIN_HTML: &str = r#"<!doctype html>
<html><head><meta charset="utf-8"><title>Hub Marketplace — Review Queue</title>
<style>
body{font-family:system-ui;background:#0b0c10;color:#ddd;max-width:920px;margin:24px auto;padding:0 16px}
input,button,textarea{font:inherit;background:#15171d;color:#ddd;border:1px solid #333;border-radius:6px;padding:6px 10px}
button{cursor:pointer}button.ok{border-color:#2c7}button.no{border-color:#c44}
.card{border:1px solid #2a2d35;border-radius:10px;padding:14px;margin:14px 0;background:#101218}
pre{background:#0d0f14;border:1px solid #23262e;border-radius:8px;padding:10px;overflow:auto;max-height:320px;font-size:12px}
.perm{display:inline-block;background:#1d2436;border:1px solid #35507a;border-radius:5px;padding:1px 8px;margin:2px;font-size:12px}
.preview{max-width:220px;max-height:220px;display:block;border:1px solid #2a2d35;border-radius:8px;margin:8px 0}
.ai{border-left:3px solid #557;padding-left:10px;margin:8px 0;font-size:13px}
small{color:#889}
</style></head><body>
<h1>Review queue</h1>
<div id="auth">Admin token: <input id="tok" type="password" size="40"> <button onclick="saveTok()">Load queue</button></div>
<div id="list"></div>
<script>
const $=id=>document.getElementById(id);
function tok(){return sessionStorage.getItem('admtok')||''}
function saveTok(){sessionStorage.setItem('admtok',$('tok').value);load()}
async function load(){
  const r=await fetch('/admin/queue',{headers:{Authorization:'Bearer '+tok()}});
  if(!r.ok){$('list').innerHTML='<p>forbidden — check token</p>';return}
  const q=(await r.json()).pending;
  $('list').innerHTML=q.length?'':'<p>Queue is empty 🎉</p>';
  for(const b of q){
    const el=document.createElement('div');el.className='card';
    const perms=(b.permissions||[]).map(p=>'<span class=perm>'+p+'</span>').join('')||'<small>no permissions</small>';
    const ai=b.ai_report?('<div class=ai><b>AI review ('+(b.ai_report.verdict||'?')+'):</b> '+(b.ai_report.notes||'')+'</div>'):'<div class=ai><small>no AI report</small></div>';
    const diff=b.diff_base?'<details><summary>Previous approved version (diff base)</summary><pre></pre></details>':'';
    const preview=b.preview?'<img class=preview src="'+b.preview+'" alt="preview">':'';
    el.innerHTML='<b>'+b.name+'</b> <small>'+b.id+' v'+b.version+' · '+b.kind+' · by '+b.author+'</small><br>'+preview+perms+ai+
      '<details open><summary>code</summary><pre></pre></details>'+diff+
      '<input placeholder="note (optional)" size=40 class=note> '+
      '<button class=ok>Approve</button> <button class=no>Reject</button>';
    el.querySelector('details pre').textContent=b.code||b.manifest;
    if(b.diff_base)el.querySelectorAll('pre')[1].textContent=b.diff_base;
    const send=async ok=>{
      await fetch('/admin/decide',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tok()},
        body:JSON.stringify({id:b.id,version:b.version,approve:ok,note:el.querySelector('.note').value||null})});
      load();
    };
    el.querySelector('.ok').onclick=()=>send(true);
    el.querySelector('.no').onclick=()=>send(false);
    $('list').appendChild(el);
  }
}
if(tok())load();
</script></body></html>"#;
