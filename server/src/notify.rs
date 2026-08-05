//! Notifications.
//!
//! A community where contribution is invisible dies quietly: people post,
//! nobody appears to notice, and they stop. This is the feedback loop —
//! somebody followed you, replied to you, commented on your work, or a
//! moderator acted on your account.
//!
//! Three rules keep it from becoming noise:
//!
//!   * You are never notified about your own actions. Following the rule
//!     everywhere means no "you replied to yourself".
//!   * Blocks apply. Someone you blocked cannot reach your inbox by
//!     @-mentioning you, which is otherwise the obvious way around a block.
//!   * Notifications are best-effort. A failed insert must never fail the
//!     comment that caused it — the post is the point, the notification is
//!     the courtesy.
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde_json::{json, Value};

use crate::auth::bearer_user;
use crate::AppState;

/// Kept short so the inbox stays readable and one long comment cannot fill
/// the panel.
const EXCERPT: usize = 140;

pub fn excerpt(body: &str) -> String {
    let trimmed = body.trim();
    if trimmed.chars().count() <= EXCERPT {
        return trimmed.to_string();
    }
    let cut: String = trimmed.chars().take(EXCERPT).collect();
    format!("{cut}…")
}

/// Handles mentioned in a body: `@name`, lowercased and deduplicated.
///
/// Pure, and the reason it is worth its own function: the rules are fiddly.
/// A handle is `[a-z0-9_-]{3,24}`, an `@` inside a word is not a mention
/// (`me@example.com` must not notify `example`), and the same name twice is
/// one notification.
pub fn mentions(body: &str) -> Vec<String> {
    let bytes: Vec<char> = body.chars().collect();
    let mut out: Vec<String> = Vec::new();
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] != '@' {
            i += 1;
            continue;
        }
        // An '@' glued to the end of a word is an email or a decoration,
        // never a mention.
        let preceded_by_word = i > 0 && (bytes[i - 1].is_alphanumeric() || bytes[i - 1] == '.');
        if preceded_by_word {
            i += 1;
            continue;
        }
        let mut j = i + 1;
        let mut name = String::new();
        while j < bytes.len() {
            let c = bytes[j].to_ascii_lowercase();
            if c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_' {
                name.push(c);
                j += 1;
            } else {
                break;
            }
        }
        if name.len() >= 3 && name.len() <= 24 && !out.contains(&name) {
            out.push(name);
        }
        i = j.max(i + 1);
    }
    out
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Deliver one notification. Best-effort: the caller's own write already
/// succeeded, and failing it now would be worse than a missing note.
///
/// Silently drops self-notifications and anything the recipient has blocked.
pub fn push(
    db: &rusqlite::Connection,
    recipient: i64,
    actor: Option<i64>,
    kind: &str,
    target_kind: &str,
    target_id: &str,
    body: &str,
) {
    if Some(recipient) == actor {
        return;
    }
    if let Some(a) = actor {
        // A block has to cover the inbox too, or @-mentioning is the way
        // around it.
        let blocked: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM blocks WHERE user_id = ?1 AND blocked_id = ?2",
                [recipient, a],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if blocked > 0 {
            return;
        }
    }
    // Snapshotted, like the audit log: the inbox still reads correctly after
    // the actor renames or leaves.
    let actor_handle: Option<String> = actor.and_then(|a| {
        db.query_row("SELECT handle FROM users WHERE id = ?1", [a], |r| r.get(0))
            .ok()
            .flatten()
    });
    let _ = db.execute(
        "INSERT INTO notifications
           (user_id, kind, actor_handle, target_kind, target_id, body, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![recipient, kind, actor_handle, target_kind, target_id, excerpt(body), now()],
    );
}

/// Notify everyone named in `body`. Unknown handles are simply not there to
/// notify, which is the right outcome for a typo.
pub fn push_mentions(
    db: &rusqlite::Connection,
    actor: i64,
    kind: &str,
    target_kind: &str,
    target_id: &str,
    body: &str,
) {
    for handle in mentions(body) {
        let id: Option<i64> = db
            .query_row(
                "SELECT id FROM users WHERE handle = ?1 AND suspended = 0",
                [&handle],
                |r| r.get(0),
            )
            .ok();
        if let Some(uid) = id {
            push(db, uid, Some(actor), kind, target_kind, target_id, body);
        }
    }
}

/// The bundle author's user id, for "somebody commented on your work".
pub fn bundle_author(db: &rusqlite::Connection, bundle_id: &str) -> Option<i64> {
    db.query_row(
        "SELECT author_id FROM bundles WHERE id = ?1 AND status = 'approved' LIMIT 1",
        [bundle_id],
        |r| r.get(0),
    )
    .ok()
}

pub async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, StatusCode> {
    // Resolved before the lock — parking_lot is not reentrant.
    let user = bearer_user(&state, &headers)?;
    let db = state.db.lock();

    let mut stmt = db
        .prepare(
            "SELECT id, kind, actor_handle, target_kind, target_id, body, created_at, read_at
             FROM notifications WHERE user_id = ?1
             ORDER BY id DESC LIMIT 100",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let rows: Vec<Value> = stmt
        .query_map([user], |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "kind": r.get::<_, String>(1)?,
                "actor": r.get::<_, Option<String>>(2)?,
                "targetKind": r.get::<_, Option<String>>(3)?,
                "targetId": r.get::<_, Option<String>>(4)?,
                "body": r.get::<_, Option<String>>(5)?,
                "createdAt": r.get::<_, i64>(6)?,
                "readAt": r.get::<_, Option<i64>>(7)?,
            }))
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Counted over ALL unread, not just the page — a badge that stops at 100
    // would quietly lie.
    let unread: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM notifications WHERE user_id = ?1 AND read_at IS NULL",
            [user],
            |r| r.get(0),
        )
        .unwrap_or(0);

    Ok(Json(json!({ "notifications": rows, "unread": unread })))
}

/// Mark one as read, or all of them when no id is given.
pub async fn mark_read(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, StatusCode> {
    let user = bearer_user(&state, &headers)?;
    let db = state.db.lock();
    let ts = now();
    match body.get("id").and_then(Value::as_i64) {
        // The user_id predicate is not decoration: without it, anyone could
        // mark anyone else's notifications read by guessing an id.
        Some(id) => {
            db.execute(
                "UPDATE notifications SET read_at = ?1 WHERE id = ?2 AND user_id = ?3 AND read_at IS NULL",
                rusqlite::params![ts, id, user],
            )
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        }
        None => {
            db.execute(
                "UPDATE notifications SET read_at = ?1 WHERE user_id = ?2 AND read_at IS NULL",
                rusqlite::params![ts, user],
            )
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        }
    }
    Ok(Json(json!({ "ok": true })))
}

#[cfg(test)]
mod tests {
    use super::{excerpt, mentions};

    #[test]
    fn a_plain_mention_is_found() {
        assert_eq!(mentions("thanks @oliver for this"), vec!["oliver"]);
    }

    #[test]
    fn mentions_are_lowercased_and_deduplicated() {
        assert_eq!(mentions("@Oliver and @OLIVER and @oliver"), vec!["oliver"]);
    }

    // The case that makes this worth its own function: an email address must
    // not notify whoever happens to own the domain's first label.
    #[test]
    fn an_email_address_is_not_a_mention() {
        assert!(mentions("write to me@example.com").is_empty());
        assert!(mentions("me@oliver").is_empty());
    }

    #[test]
    fn handles_that_could_not_exist_are_ignored() {
        // Below the 3-character minimum, and above the 24-character maximum.
        assert!(mentions("@ab").is_empty());
        assert!(mentions("@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").is_empty());
    }

    #[test]
    fn punctuation_ends_a_mention() {
        assert_eq!(mentions("hey @oliver, look"), vec!["oliver"]);
        assert_eq!(mentions("(@oliver)"), vec!["oliver"]);
        assert_eq!(mentions("@oliver's thing"), vec!["oliver"]);
    }

    #[test]
    fn several_mentions_come_back_in_order() {
        assert_eq!(mentions("@alpha @beta @gamma"), vec!["alpha", "beta", "gamma"]);
    }

    #[test]
    fn a_bare_at_is_harmless() {
        assert!(mentions("@").is_empty());
        assert!(mentions("@@@").is_empty());
        assert!(mentions("").is_empty());
    }

    #[test]
    fn excerpts_are_capped_so_one_long_post_cannot_fill_the_inbox() {
        let long = "x".repeat(500);
        let cut = excerpt(&long);
        assert!(cut.chars().count() <= 141, "140 plus the ellipsis");
        assert!(cut.ends_with('…'));
        assert_eq!(excerpt("  short  "), "short");
    }
}
