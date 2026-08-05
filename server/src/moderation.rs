//! Moderation actions, every one of them written down.
//!
//! Nothing here is destructive. Hiding sets a flag rather than deleting a
//! row, suspending hides someone's work rather than erasing it, and removing
//! an avatar moves the bytes aside rather than dropping them — an admin
//! dealing with abuse should not also be destroying the evidence of it, and
//! the row's primary key is what stops the same person re-posting into a
//! fresh one.
//!
//! Two rules shape the rest.
//!
//! FIRST: an action that changed nothing is not a success. `execute`
//! returning 0 rows used to be treated exactly like returning 1, so a hide
//! button pointed at the wrong table reported "done" and left the content in
//! place. Every arm checks what it actually touched.
//!
//! SECOND: every action is recorded, and wherever possible it is reversible.
//! The audit row captures the PRIOR state before the change, which is the
//! only way to undo the actions that are not a simple flag flip — you cannot
//! restore a role or a handle you never wrote down. Actions that genuinely
//! cannot be reversed are marked so in the log rather than offered an undo
//! button that would fail.
use crate::roles::{require, Actor, Role};
use crate::state::AppState;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde_json::{json, Value};

type Err = (StatusCode, String);

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// The privilege an action needs. Content is moderator work; anything
/// touching a PERSON or their permissions reaches across everything they have
/// ever posted, so it needs an admin.
pub fn needed_for(action: &str) -> Role {
    match action {
        "suspend" | "unsuspend" | "rename-handle" | "grant-badge" | "revoke-badge"
        | "set-role" | "set-password" => Role::Admin,
        _ => Role::Moderator,
    }
}

/// The action that reverses `action`, given the prior state captured when it
/// ran. `None` means genuinely irreversible.
fn inverse(action: &str, args: &Value, prior: &Value) -> Option<(String, Value)> {
    let id = args.get("id").cloned().unwrap_or(Value::Null);
    let handle = args.get("handle").cloned().unwrap_or(Value::Null);
    match action {
        "hide-comment" => Some(("unhide-comment".into(), json!({ "id": id }))),
        "unhide-comment" => Some(("hide-comment".into(), json!({ "id": id }))),
        "hide-topic" => Some(("unhide-topic".into(), json!({ "id": id }))),
        "unhide-topic" => Some(("hide-topic".into(), json!({ "id": id }))),
        "hide-reply" => Some(("unhide-reply".into(), json!({ "id": id }))),
        "unhide-reply" => Some(("hide-reply".into(), json!({ "id": id }))),
        "hide-shout" => Some(("unhide-shout".into(), json!({ "id": id }))),
        "unhide-shout" => Some(("hide-shout".into(), json!({ "id": id }))),
        "hide-review" => Some((
            "unhide-review".into(),
            json!({ "bundleId": args.get("bundleId"), "handle": handle }),
        )),
        "unhide-review" => Some((
            "hide-review".into(),
            json!({ "bundleId": args.get("bundleId"), "handle": handle }),
        )),
        "suspend" => Some(("unsuspend".into(), json!({ "handle": handle }))),
        "unsuspend" => Some(("suspend".into(), json!({ "handle": handle }))),
        "grant-badge" => Some((
            "revoke-badge".into(),
            json!({ "handle": handle, "badge": args.get("badge") }),
        )),
        "revoke-badge" => Some((
            "grant-badge".into(),
            json!({ "handle": handle, "badge": args.get("badge") }),
        )),
        // Needs what it WAS, which only the audit row knows.
        "set-role" => prior
            .get("role")
            .filter(|r| !r.is_null())
            .map(|r| ("set-role".into(), json!({ "handle": handle, "role": r }))),
        // Undone by renaming back: the new name is the target now, and the
        // prior row holds the original.
        "rename-handle" => prior.get("handle").filter(|h| !h.is_null()).map(|old| {
            (
                "rename-handle".into(),
                json!({ "handle": args.get("newHandle"), "newHandle": old }),
            )
        }),
        "remove-avatar" => Some(("restore-avatar".into(), json!({ "handle": handle }))),
        "restore-avatar" => Some(("remove-avatar".into(), json!({ "handle": handle }))),
        "revoke-invite" => Some(("restore-invite".into(), json!({ "code": args.get("code") }))),
        "restore-invite" => Some(("revoke-invite".into(), json!({ "code": args.get("code") }))),
        // "set-password" has NO inverse on purpose -- see the arm in `apply`.
        "resolve" => Some(("reopen".into(), json!({ "id": id }))),
        "reopen" => Some(("resolve".into(), json!({ "id": id }))),
        _ => None,
    }
}

/// Prior state worth keeping, read BEFORE the change. Only the actions whose
/// inverse cannot be derived from the arguments alone need one.
fn capture_prior(db: &rusqlite::Connection, action: &str, args: &Value) -> Value {
    let handle = crate::handle::normalise(args.get("handle").and_then(Value::as_str).unwrap_or(""));
    match action {
        "set-role" => {
            let role: Option<String> = db
                .query_row(
                    "SELECT COALESCE(role, 'user') FROM users WHERE handle = ?1",
                    [&handle],
                    |r| r.get(0),
                )
                .ok();
            json!({ "role": role })
        }
        "rename-handle" => json!({ "handle": handle }),
        _ => Value::Null,
    }
}

/// Apply one action. Permission is the caller's job — both `act` and `undo`
/// check before calling in.
fn apply(db: &rusqlite::Connection, actor: Actor, action: &str, body: &Value) -> Result<(), Err> {
    let want_id = || -> Result<i64, Err> {
        body.get("id")
            .and_then(Value::as_i64)
            .ok_or((StatusCode::BAD_REQUEST, "id required".to_string()))
    };
    let want_handle =
        || crate::handle::normalise(body.get("handle").and_then(Value::as_str).unwrap_or(""));

    // A moderation action that changed NOTHING must not report success.
    let touched = |n: usize, what: &str| -> Result<(), Err> {
        if n == 0 {
            Err((StatusCode::NOT_FOUND, format!("no such {what}")))
        } else {
            Ok(())
        }
    };

    match action {
        "hide-comment" | "unhide-comment" => {
            let hidden = i64::from(action == "hide-comment");
            let n = db
                .execute(
                    "UPDATE comments SET hidden = ?1 WHERE id = ?2",
                    rusqlite::params![hidden, want_id()?],
                )
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            touched(n, "comment")?;
        }
        "hide-review" | "unhide-review" => {
            let bundle = body.get("bundleId").and_then(Value::as_str).unwrap_or("");
            let hidden = i64::from(action == "hide-review");
            let n = db
                .execute(
                    "UPDATE reviews SET hidden = ?1
                     WHERE bundle_id = ?2 AND user_id = (SELECT id FROM users WHERE handle = ?3)",
                    rusqlite::params![hidden, bundle, want_handle()],
                )
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            touched(n, "review")?;
        }
        "hide-topic" | "unhide-topic" => {
            let hidden = i64::from(action == "hide-topic");
            let n = db
                .execute(
                    "UPDATE topics SET hidden = ?1 WHERE id = ?2",
                    rusqlite::params![hidden, want_id()?],
                )
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            touched(n, "topic")?;
        }
        "hide-reply" | "unhide-reply" => {
            let hidden = i64::from(action == "hide-reply");
            let n = db
                .execute(
                    "UPDATE topic_replies SET hidden = ?1 WHERE id = ?2",
                    rusqlite::params![hidden, want_id()?],
                )
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            touched(n, "reply")?;
        }
        "hide-shout" | "unhide-shout" => {
            let hidden = i64::from(action == "hide-shout");
            let n = db
                .execute(
                    "UPDATE shouts SET hidden = ?1 WHERE id = ?2",
                    rusqlite::params![hidden, want_id()?],
                )
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            // Shouts age out of the rolling window, so a miss is a real
            // answer rather than a bug: the thing may simply be gone.
            touched(n, "shout in the window")?;
        }
        "suspend" | "unsuspend" => {
            let suspended = i64::from(action == "suspend");
            let n = db
                .execute(
                    "UPDATE users SET suspended = ?1 WHERE handle = ?2",
                    rusqlite::params![suspended, want_handle()],
                )
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            touched(n, "creator")?;
        }
        "rename-handle" => {
            // The one path that can change a handle. Self-service renaming
            // would let someone shed a reputation and would rot every link to
            // their work, so it lives here.
            let from = want_handle();
            let to_raw = body.get("newHandle").and_then(Value::as_str).unwrap_or("");
            let to = crate::handle::validate(to_raw)
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
            let n = db
                .execute(
                    "UPDATE users SET handle = ?1, avatar_seed = ?1 WHERE handle = ?2",
                    rusqlite::params![to, from],
                )
                .map_err(|_| (StatusCode::CONFLICT, "that handle is taken".to_string()))?;
            touched(n, "creator")?;
        }
        "remove-avatar" | "restore-avatar" => {
            // Moved aside, never deleted — the only reason removing a picture
            // is undoable at all.
            let (sql, what) = if action == "remove-avatar" {
                (
                    "UPDATE users SET avatar_removed = avatar, avatar = NULL
                     WHERE handle = ?1 AND avatar IS NOT NULL",
                    "picture to remove",
                )
            } else {
                (
                    "UPDATE users SET avatar = avatar_removed, avatar_removed = NULL
                     WHERE handle = ?1 AND avatar_removed IS NOT NULL",
                    "picture to restore",
                )
            };
            let n = db
                .execute(sql, [want_handle()])
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            touched(n, what)?;
        }
        "grant-badge" | "revoke-badge" => {
            // Admin-granted only — there is no self-service path anywhere,
            // which is the entire point of a badge.
            let handle = want_handle();
            let badge = body
                .get("badge")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_lowercase();
            if badge.is_empty()
                || badge.len() > 24
                || !badge
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
            {
                return Err((StatusCode::BAD_REQUEST, "badge must be lowercase a-z0-9-".into()));
            }
            let current: String = db
                .query_row("SELECT badges FROM users WHERE handle = ?1", [&handle], |r| r.get(0))
                .map_err(|_| (StatusCode::NOT_FOUND, "no such creator".to_string()))?;
            let mut list: Vec<String> = serde_json::from_str(&current).unwrap_or_default();
            list.retain(|b| b != &badge);
            if action == "grant-badge" {
                list.push(badge);
            }
            let encoded = serde_json::to_string(&list).unwrap_or_else(|_| "[]".into());
            db.execute(
                "UPDATE users SET badges = ?1 WHERE handle = ?2",
                rusqlite::params![encoded, handle],
            )
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        }
        "set-role" => {
            let handle = want_handle();
            let raw = body.get("role").and_then(Value::as_str).unwrap_or("");
            let role = Role::parse(raw);
            let normalised = raw.trim().to_lowercase();
            if role.as_str() != normalised && normalised != "mod" {
                return Err((
                    StatusCode::BAD_REQUEST,
                    "role must be user, moderator or admin".into(),
                ));
            }

            // You cannot demote yourself. Not paternalism: an admin who
            // removes their own last privilege has locked everyone out of the
            // panel, and the only way back is the shared token on the server
            // box. Someone ELSE can always demote them.
            if let Some(me) = actor.user_id() {
                let target: Option<i64> = db
                    .query_row("SELECT id FROM users WHERE handle = ?1", [&handle], |r| r.get(0))
                    .ok();
                if target == Some(me) && role < Role::Admin {
                    return Err((
                        StatusCode::BAD_REQUEST,
                        "you cannot remove your own admin role -- ask another admin".into(),
                    ));
                }
            }

            let n = db
                .execute(
                    "UPDATE users SET role = ?1 WHERE handle = ?2",
                    rusqlite::params![role.as_str(), handle],
                )
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            touched(n, "creator")?;
        }
        "revoke-invite" | "restore-invite" => {
            let code = crate::invites::normalise(
                body.get("code").and_then(Value::as_str).unwrap_or(""),
            );
            let revoked = i64::from(action == "revoke-invite");
            let n = db
                .execute(
                    "UPDATE invites SET revoked = ?1 WHERE code = ?2",
                    rusqlite::params![revoked, code],
                )
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            touched(n, "invite code")?;
        }
        "set-password" => {
            // The recovery path while there is no mail relay. An admin sets a
            // temporary password and tells the person out of band; they change
            // it once they are in.
            //
            // NOT undoable, and marked so: the previous hash is deliberately
            // not recorded anywhere. Keeping it to enable an undo would mean
            // storing a way back into somebody's account long after the reset,
            // which is a worse thing to own than a lost password.
            let handle = want_handle();
            let password = body.get("password").and_then(Value::as_str).unwrap_or("");
            if password.len() < 8 {
                return Err((StatusCode::BAD_REQUEST, "password must be at least 8 characters".into()));
            }
            let hash = crate::auth::hash_password(password)
                .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "could not hash".to_string()))?;
            let n = db
                .execute(
                    "UPDATE users SET pass_hash = ?1 WHERE handle = ?2",
                    rusqlite::params![hash, handle],
                )
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            touched(n, "creator")?;

            // Every existing session dies with the password. A reset that
            // leaves the old sessions alive does not lock anyone out.
            let _ = db.execute(
                "DELETE FROM tokens
                 WHERE kind = 'session'
                   AND user_id = (SELECT id FROM users WHERE handle = ?1)",
                [&handle],
            );
        }
        "resolve" | "reopen" => {
            let status = if action == "resolve" { "closed" } else { "open" };
            let n = db
                .execute(
                    "UPDATE reports SET status = ?1 WHERE id = ?2",
                    rusqlite::params![status, want_id()?],
                )
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            touched(n, "report")?;
        }
        _ => return Err((StatusCode::BAD_REQUEST, "unknown action".into())),
    }
    Ok(())
}

/// Write the action down. Best-effort by design: a successful moderation
/// action must not be reported as a failure because the LOG write failed —
/// the content is already hidden either way, and an error here would tell the
/// moderator to do it again.
fn record(
    db: &rusqlite::Connection,
    actor: Actor,
    action: &str,
    args: &Value,
    prior: &Value,
    undoable: bool,
) {
    // The handle is SNAPSHOTTED rather than joined at read time, so the log
    // still names who did it after a rename — or after the account is gone.
    let actor_handle: Option<String> = match actor.user_id() {
        Some(id) => db
            .query_row("SELECT handle FROM users WHERE id = ?1", [id], |r| r.get(0))
            .ok()
            .flatten(),
        None => None,
    };
    let _ = db.execute(
        "INSERT INTO audit (actor_id, actor_handle, action, args, prior, undoable, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            actor.user_id(),
            actor_handle,
            action,
            args.to_string(),
            prior.to_string(),
            i64::from(undoable),
            now(),
        ],
    );
}

/// Act on a report, or act directly.
pub async fn act(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, Err> {
    let action = body
        .get("action")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let actor = require(&state, &headers, needed_for(&action))
        .map_err(|s| (s, "you do not have permission for that".to_string()))?;

    let db = state.db.lock();
    let prior = capture_prior(&db, &action, &body);
    apply(&db, actor, &action, &body)?;

    let undoable = inverse(&action, &body, &prior).is_some();
    record(&db, actor, &action, &body, &prior, undoable);
    Ok(Json(json!({ "ok": true })))
}

/// The log. Moderators see all of it, their own actions included — a log only
/// one person can read is not accountability.
pub async fn audit(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, StatusCode> {
    require(&state, &headers, Role::Moderator)?;
    let db = state.db.lock();
    let mut stmt = db
        .prepare(
            "SELECT id, actor_handle, action, args, prior, undoable, created_at, undone_at, undone_by
             FROM audit ORDER BY id DESC LIMIT 300",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let rows: Vec<Value> = stmt
        .query_map([], |r| {
            let args: String = r.get(3)?;
            let prior: String = r.get(4)?;
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                // Null means the shared ADMIN_TOKEN, which belongs to whoever
                // holds it. The client says so rather than inventing a name.
                "actor": r.get::<_, Option<String>>(1)?,
                "action": r.get::<_, String>(2)?,
                "args": serde_json::from_str::<Value>(&args).unwrap_or(Value::Null),
                "prior": serde_json::from_str::<Value>(&prior).unwrap_or(Value::Null),
                "undoable": r.get::<_, i64>(5)? != 0,
                "createdAt": r.get::<_, i64>(6)?,
                "undoneAt": r.get::<_, Option<i64>>(7)?,
                "undoneBy": r.get::<_, Option<String>>(8)?,
            }))
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(json!({ "entries": rows })))
}

/// Undo one logged action.
///
/// The undo is itself an action: it needs the privilege the ORIGINAL needed,
/// and it is written to the log too. An admin-only action cannot be reversed
/// by a moderator just because it appears in a list they can read.
pub async fn undo(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, Err> {
    let id = body
        .get("id")
        .and_then(Value::as_i64)
        .ok_or((StatusCode::BAD_REQUEST, "id required".to_string()))?;

    // Read and release: `require` below locks the database itself, and
    // parking_lot's Mutex is not reentrant.
    let (action, args, prior, undoable, already): (String, String, String, i64, Option<i64>) = {
        let db = state.db.lock();
        db.query_row(
            "SELECT action, args, prior, undoable, undone_at FROM audit WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .map_err(|_| (StatusCode::NOT_FOUND, "no such audit entry".to_string()))?
    };

    if already.is_some() {
        return Err((StatusCode::CONFLICT, "that action has already been undone".into()));
    }
    if undoable == 0 {
        return Err((StatusCode::BAD_REQUEST, "that action cannot be undone".into()));
    }

    let args: Value = serde_json::from_str(&args).unwrap_or(Value::Null);
    let prior: Value = serde_json::from_str(&prior).unwrap_or(Value::Null);
    let (inv_action, inv_args) = inverse(&action, &args, &prior)
        .ok_or((StatusCode::BAD_REQUEST, "that action cannot be undone".to_string()))?;

    // The higher of the two bars: undoing a suspension is an admin matter
    // even though `unsuspend` on its own would be too.
    let needed = needed_for(&action).max(needed_for(&inv_action));
    let actor = require(&state, &headers, needed)
        .map_err(|s| (s, "you do not have permission to undo that".to_string()))?;

    let db = state.db.lock();
    apply(&db, actor, &inv_action, &inv_args)?;

    let undone_by: Option<String> = match actor.user_id() {
        Some(uid) => db
            .query_row("SELECT handle FROM users WHERE id = ?1", [uid], |r| r.get(0))
            .ok()
            .flatten(),
        None => None,
    };
    let _ = db.execute(
        "UPDATE audit SET undone_at = ?1, undone_by = ?2 WHERE id = ?3",
        rusqlite::params![now(), undone_by, id],
    );
    // The undo is itself logged, so the history reads forwards: what was
    // done, and what was done about it. Not undoable in turn — you redo by
    // taking the original action again, which keeps the chain honest.
    record(&db, actor, &inv_action, &inv_args, &Value::Null, false);

    Ok(Json(json!({ "ok": true, "applied": inv_action })))
}

/// Open reports, newest first, with enough context to act without a second
/// request. Moderators read it — triaging is the everyday job, and requiring
/// an admin would mean nobody but the owner ever looks.
pub async fn queue(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, Err> {
    require(&state, &headers, Role::Moderator)
        .map_err(|s| (s, "you do not have permission for that".to_string()))?;
    let db = state.db.lock();
    let mut stmt = db
        .prepare(
            "SELECT r.id, r.target_kind, r.target_id, r.reason, r.created_at, u.handle
             FROM reports r LEFT JOIN users u ON u.id = r.reporter_id
             WHERE r.status = 'open'
             ORDER BY r.created_at DESC
             LIMIT 200",
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let rows = stmt
        .query_map([], |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "targetKind": r.get::<_, String>(1)?,
                "targetId": r.get::<_, String>(2)?,
                "reason": r.get::<_, String>(3)?,
                "createdAt": r.get::<_, i64>(4)?,
                "reportedBy": r.get::<_, Option<String>>(5)?,
            }))
        })
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(json!({ "reports": rows })))
}
