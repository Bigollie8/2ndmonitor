//! Admin review queue. Everything here requires `Authorization: Bearer
//! <ADMIN_TOKEN>`; when ADMIN_TOKEN is unconfigured the endpoints refuse —
//! there is no default credential. A human always clicks approve: the AI
//! report shown alongside each pending bundle is advisory only.

use crate::state::AppState;
use crate::submit::zip_bundle;
use axum::extract::State;
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
                     ORDER BY p.created_at DESC LIMIT 1) AS diff_base
             FROM bundles b JOIN users u ON u.id = b.author_id
             WHERE b.status = 'pending' ORDER BY b.created_at",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let rows = stmt
        .query_map([], |r| {
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
        db.execute(
            "UPDATE bundles SET status='approved', zip=?1, sha256=?2, size=?3, review_note=?4 WHERE id=?5 AND version=?6",
            rusqlite::params![zip, sha, size, body.note, body.id, body.version],
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
    el.innerHTML='<b>'+b.name+'</b> <small>'+b.id+' v'+b.version+' · '+b.kind+' · by '+b.author+'</small><br>'+perms+ai+
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
