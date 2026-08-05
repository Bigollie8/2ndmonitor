//! Invite codes.
//!
//! Email verification exists to stop one person minting unlimited accounts.
//! An invite achieves the same thing without a mail relay: somebody with an
//! account vouched for you by handing you a code, and a code can only be
//! spent as many times as its issuer allowed.
//!
//! So an invited account is created ALREADY VERIFIED. There is nothing left
//! to prove — requiring an email confirmation on top would be asking for a
//! second proof of the same fact, from a channel that may not exist.
//!
//! Invites and email verification coexist deliberately. A code lets people in
//! today; configuring SMTP later opens the doors wider without taking the
//! codes away.
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde_json::{json, Value};

use crate::roles::{require, Role};
use crate::AppState;

/// Unambiguous alphabet: no O/0, no I/1/l. These get read aloud, typed from a
/// screenshot, and copied out of chat messages.
const ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LEN: usize = 12;

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Grouped `XXXX-XXXX-XXXX` for the same reason: humans transcribe it.
pub fn format_code(raw: &str) -> String {
    raw.as_bytes()
        .chunks(4)
        .map(|c| String::from_utf8_lossy(c).to_string())
        .collect::<Vec<_>>()
        .join("-")
}

/// Uppercased, with separators and spaces removed, so every way somebody
/// might type it lands on the same key.
pub fn normalise(raw: &str) -> String {
    raw.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_uppercase())
        .collect()
}

fn generate() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    (0..CODE_LEN)
        .map(|_| ALPHABET[rng.gen_range(0..ALPHABET.len())] as char)
        .collect()
}

/// Spend one use of a code, or explain why not.
///
/// Returns Ok only when the code existed, was live, and had a use left — and
/// it consumes that use in the same call, so a race cannot spend the last one
/// twice.
pub fn redeem(db: &rusqlite::Connection, raw: &str) -> Result<(), String> {
    let code = normalise(raw);
    if code.is_empty() {
        return Err("an invite code is required".into());
    }
    let row: Option<(i64, i64, Option<i64>, i64)> = db
        .query_row(
            "SELECT uses, max_uses, expires_at, revoked FROM invites WHERE code = ?1",
            [&code],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .ok();
    let Some((uses, max_uses, expires_at, revoked)) = row else {
        return Err("that invite code is not valid".into());
    };
    if revoked != 0 {
        return Err("that invite code has been revoked".into());
    }
    if let Some(exp) = expires_at {
        if now() > exp {
            return Err("that invite code has expired".into());
        }
    }
    if uses >= max_uses {
        return Err("that invite code has already been used".into());
    }
    // Conditional UPDATE rather than a read-then-write: the WHERE clause
    // re-checks the count, so two simultaneous redemptions cannot both spend
    // the last use.
    let n = db
        .execute(
            "UPDATE invites SET uses = uses + 1 WHERE code = ?1 AND uses < max_uses AND revoked = 0",
            [&code],
        )
        .map_err(|_| "could not redeem that code".to_string())?;
    if n == 0 {
        return Err("that invite code has already been used".into());
    }
    Ok(())
}

/// Mint a code. Any moderator may — handing out invites is everyday work, and
/// every code is attributed in the list.
pub async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let actor = require(&state, &headers, Role::Moderator)
        .map_err(|s| (s, "you do not have permission for that".to_string()))?;

    let note = body.get("note").and_then(Value::as_str).unwrap_or("").trim().to_string();
    if note.chars().count() > 80 {
        return Err((StatusCode::BAD_REQUEST, "note must be at most 80 characters".into()));
    }
    // Capped: an unlimited code handed to the wrong person is an open door
    // with no way to tell how far it swung.
    let max_uses = body.get("maxUses").and_then(Value::as_i64).unwrap_or(1).clamp(1, 100);
    let expires_at = match body.get("expiresInDays").and_then(Value::as_i64) {
        Some(d) if d > 0 => Some(now() + d.clamp(1, 365) * 86_400),
        _ => None,
    };

    let code = generate();
    let db = state.db.lock();
    db.execute(
        "INSERT INTO invites (code, created_by, created_at, note, max_uses, uses, expires_at, revoked)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, 0)",
        rusqlite::params![code, actor.user_id(), now(), note, max_uses, expires_at],
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(json!({ "ok": true, "code": format_code(&code) })))
}

pub async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, StatusCode> {
    require(&state, &headers, Role::Moderator)?;
    let db = state.db.lock();
    let mut stmt = db
        .prepare(
            "SELECT i.code, i.note, i.max_uses, i.uses, i.expires_at, i.revoked, i.created_at,
                    u.handle
             FROM invites i LEFT JOIN users u ON u.id = i.created_by
             ORDER BY i.created_at DESC LIMIT 200",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let rows: Vec<Value> = stmt
        .query_map([], |r| {
            let raw: String = r.get(0)?;
            Ok(json!({
                "code": format_code(&raw),
                "note": r.get::<_, Option<String>>(1)?,
                "maxUses": r.get::<_, i64>(2)?,
                "uses": r.get::<_, i64>(3)?,
                "expiresAt": r.get::<_, Option<i64>>(4)?,
                "revoked": r.get::<_, i64>(5)? != 0,
                "createdAt": r.get::<_, i64>(6)?,
                // Null means the shared token, same as everywhere else.
                "createdBy": r.get::<_, Option<String>>(7)?,
            }))
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(json!({ "invites": rows })))
}

#[cfg(test)]
mod tests {
    use super::{format_code, normalise};

    #[test]
    fn a_code_is_grouped_for_humans_to_transcribe() {
        assert_eq!(format_code("ABCDEFGHJKMN"), "ABCD-EFGH-JKMN");
    }

    // People type these from a screenshot, read them aloud, and paste them
    // out of chat with stray spacing. Every one of those must land on the
    // same key.
    #[test]
    fn every_way_somebody_might_type_it_normalises_the_same() {
        for typed in ["ABCD-EFGH-JKMN", "abcd efgh jkmn", "ABCDEFGHJKMN", " abcd-EFGH-jkmn "] {
            assert_eq!(normalise(typed), "ABCDEFGHJKMN", "{typed}");
        }
    }

    #[test]
    fn normalise_drops_anything_that_is_not_alphanumeric() {
        assert_eq!(normalise("A!B@C#D"), "ABCD");
        assert_eq!(normalise(""), "");
        assert_eq!(normalise("---"), "");
    }
}
