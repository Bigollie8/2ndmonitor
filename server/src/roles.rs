//! Who is allowed to moderate, and how they prove it.
//!
//! Until now "admin" meant one shared secret in `ADMIN_TOKEN`. That is fine
//! for a curl script on the server box and completely wrong for a desktop
//! app: shipping the token to clients would put a god credential on every
//! machine, and revoking it would mean rotating one secret for everybody at
//! once.
//!
//! So moderation is a property of a PERSON now. Every account carries a role,
//! and a moderator proves who they are with the same session token they
//! browse with. The shared token still works — deploy scripts and the
//! metadata backfill depend on it, and it is the bootstrap path that makes
//! the first admin possible — but it is no longer the only way in.
//!
//! Two levels, because the destructive actions deserve a higher bar than the
//! everyday ones:
//!
//!   * MODERATOR handles content: hide a comment, topic, reply or shout,
//!     remove an avatar, close a report. All reversible, all limited to one
//!     piece of content.
//!   * ADMIN handles people and permissions: suspend an account, rename a
//!     handle, grant badges, and set roles. These reach across everything
//!     somebody has ever posted.
//!
//! A moderator cannot promote themselves — role changes are admin-only, and
//! that is enforced here rather than in the UI, because a modified client is
//! not a hypothetical.
use axum::http::{HeaderMap, StatusCode};

use crate::auth::bearer_user;
use crate::AppState;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Role {
    User,
    Moderator,
    Admin,
}

impl Role {
    pub fn parse(raw: &str) -> Role {
        match raw.trim().to_lowercase().as_str() {
            "admin" => Role::Admin,
            "moderator" | "mod" => Role::Moderator,
            _ => Role::User,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Role::Admin => "admin",
            Role::Moderator => "moderator",
            Role::User => "user",
        }
    }
}

/// How a caller proved they may moderate.
///
/// Kept distinct because it decides accountability: an action taken with a
/// session belongs to a named person, while the shared token belongs to
/// whoever holds it. A report queue that cannot tell those apart is a report
/// queue nobody can audit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Actor {
    /// The shared ADMIN_TOKEN. Always full rights, never attributable.
    SharedToken,
    /// A signed-in person, with their id and role.
    Session { user_id: i64, role: Role },
}

impl Actor {
    pub fn role(self) -> Role {
        match self {
            Actor::SharedToken => Role::Admin,
            Actor::Session { role, .. } => role,
        }
    }

    /// The user id to record against an action, or None for the shared token.
    pub fn user_id(self) -> Option<i64> {
        match self {
            Actor::SharedToken => None,
            Actor::Session { user_id, .. } => Some(user_id),
        }
    }
}

fn bearer<'a>(headers: &'a HeaderMap) -> Option<&'a str> {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
}

/// The caller's role for one account. Suspended accounts lose every
/// privilege: a suspended moderator must not be able to moderate their way
/// back out.
pub fn role_of(state: &AppState, user_id: i64) -> Role {
    let db = state.db.lock();
    let row: Result<(String, i64), _> = db.query_row(
        "SELECT COALESCE(role, 'user'), suspended FROM users WHERE id = ?1",
        [user_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    );
    match row {
        Ok((raw, suspended)) if suspended == 0 => Role::parse(&raw),
        _ => Role::User,
    }
}

/// Resolve the caller, requiring at least `needed`.
///
/// Checks the shared token FIRST so deploy scripts keep working unchanged and
/// never pay for a database read.
pub fn require(
    state: &AppState,
    headers: &HeaderMap,
    needed: Role,
) -> Result<Actor, StatusCode> {
    if let (Some(expected), Some(got)) = (state.cfg.admin_token.as_deref(), bearer(headers)) {
        if got == expected {
            return Ok(Actor::SharedToken);
        }
    }

    // Resolved before any lock this function's callers hold — bearer_user
    // locks state.db itself and parking_lot is not reentrant.
    let user_id = bearer_user(state, headers).map_err(|_| StatusCode::FORBIDDEN)?;
    let role = role_of(state, user_id);
    if role < needed {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(Actor::Session { user_id, role })
}
