# Creator Profiles — Phase 2: Identity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every creator a unique, public handle, make `display_name` settable for the first time, and carry attribution into the signed index.

**Architecture:** Handle rules are a pure, table-tested function — the decision. The endpoints are thin wrappers that apply it. Schema changes go through the existing `ensure_column` additive migration, which has already survived one live migration with all 419 rows intact.

**Tech Stack:** Rust, axum, rusqlite.

## Global Constraints

- **Working directory is the repo root** for `cargo` commands.
- **A handle is required to publish.** `POST /submissions` must reject an account without one. This is the forcing function that converts the dead `display_name` column into a real one.
- **Handles are unique, enforced by a DB index**, not an application check — two concurrent claims must not both succeed.
- **Handle format, exact:** 3–24 characters, `[a-z0-9_-]`, lowercase. Input is normalised (trimmed, lowercased) before validation.
- **Reserved handles, exact list:** `admin`, `administrator`, `official`, `support`, `help`, `moderator`, `mod`, `root`, `system`, `api`, `www`, `2ndmonitor`, `secondmonitor`, `marketplace`, `staff`, `security`, `abuse`.
- **Never expose an email address.** Handles and display names are public by choice; the email stays masked exactly as `index.rs` already masks it.
- **Run `cargo test --manifest-path server/Cargo.toml` before every commit.**

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `server/src/handle.rs` | Handle normalisation + validation | **Create** |
| `server/src/db.rs` | Five new `users` columns + unique index | Modify |
| `server/src/profiles.rs` | `GET /account`, `PATCH /account`, `POST /account/handle` | **Create** |
| `server/src/lib.rs` | Module + routes | Modify |
| `server/src/submit.rs` | Require a handle to publish | Modify |
| `server/src/index.rs` | Emit `authorHandle` | Modify |
| `server/tests/handle.rs` | Handle rule tests | **Create** |
| `server/tests/profiles.rs` | Endpoint integration tests | **Create** |

---

## Task 1: Handle rules

**Files:**
- Create: `server/src/handle.rs`, `server/tests/handle.rs`
- Modify: `server/src/lib.rs`

**Interfaces:**
- Produces:
  - `pub fn normalise(raw: &str) -> String`
  - `pub fn validate(raw: &str) -> Result<String, &'static str>` — returns the normalised handle or a human-readable reason
  - `pub const RESERVED: &[&str]`

- [ ] **Step 1: Write the failing test**

Create `server/tests/handle.rs`:

```rust
use hub_marketplace::handle::{normalise, validate};

#[test]
fn normalise_trims_and_lowercases() {
    assert_eq!(normalise("  OliverJ  "), "oliverj");
}

#[test]
fn a_good_handle_round_trips() {
    assert_eq!(validate("Oliver_J"), Ok("oliver_j".to_string()));
    assert_eq!(validate("a-b-c"), Ok("a-b-c".to_string()));
    assert_eq!(validate("abc"), Ok("abc".to_string()));
}

#[test]
fn too_short_and_too_long_are_rejected() {
    assert!(validate("ab").is_err());
    assert!(validate(&"a".repeat(25)).is_err());
    assert!(validate(&"a".repeat(24)).is_ok());
}

#[test]
fn illegal_characters_are_rejected() {
    for bad in ["has space", "dot.dot", "sla/sh", "emoji\u{1F600}", "at@sign", "plus+one"] {
        assert!(validate(bad).is_err(), "{bad} should be rejected");
    }
}

// Impersonation is the cheapest attack on a marketplace: a bundle by
// "official" reads as first-party.
#[test]
fn reserved_handles_are_rejected_case_insensitively() {
    assert!(validate("admin").is_err());
    assert!(validate("ADMIN").is_err());
    assert!(validate("Official").is_err());
    assert!(validate("2ndmonitor").is_err());
}

#[test]
fn a_reserved_word_as_a_substring_is_fine() {
    assert!(validate("admin-tools").is_ok(), "only the whole handle is reserved");
}

#[test]
fn an_empty_handle_is_rejected() {
    assert!(validate("").is_err());
    assert!(validate("   ").is_err());
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --manifest-path server/Cargo.toml --test handle`
Expected: FAIL — unresolved import.

- [ ] **Step 3: Write the implementation**

Create `server/src/handle.rs`:

```rust
//! Creator handle rules.
//!
//! Pure and table-tested: a handle is the one piece of identity that appears
//! in URLs, in attribution on every card, and in the signed index, so the
//! rules for what one may be belong in a function with tests rather than
//! scattered across handlers.

/// Whole handles nobody may claim. Impersonation is the cheapest attack on a
/// marketplace — a bundle published by "official" reads as first-party — and
/// the routing-shaped ones (`api`, `www`) are reserved so a future
/// `/<handle>` route cannot collide with a real path.
pub const RESERVED: &[&str] = &[
    "admin", "administrator", "official", "support", "help", "moderator",
    "mod", "root", "system", "api", "www", "2ndmonitor", "secondmonitor",
    "marketplace", "staff", "security", "abuse",
];

pub const MIN_LEN: usize = 3;
pub const MAX_LEN: usize = 24;

/// Trim and lowercase. Applied before validation and before storage, so a
/// handle has exactly one canonical form and `Oliver` cannot coexist with
/// `oliver`.
pub fn normalise(raw: &str) -> String {
    raw.trim().to_lowercase()
}

/// The normalised handle, or a reason suitable for showing to a person.
pub fn validate(raw: &str) -> Result<String, &'static str> {
    let h = normalise(raw);
    if h.is_empty() {
        return Err("choose a handle");
    }
    if h.chars().count() < MIN_LEN {
        return Err("handles are at least 3 characters");
    }
    if h.chars().count() > MAX_LEN {
        return Err("handles are at most 24 characters");
    }
    if !h.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-') {
        return Err("handles use letters, numbers, hyphens and underscores only");
    }
    if RESERVED.contains(&h.as_str()) {
        return Err("that handle is reserved");
    }
    Ok(h)
}
```

Add `pub mod handle;` to `server/src/lib.rs`.

- [ ] **Step 4: Run the test**

Run: `cargo test --manifest-path server/Cargo.toml --test handle`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/handle.rs server/src/lib.rs server/tests/handle.rs
git commit -m "feat(server): creator handle rules"
```

---

## Task 2: Schema

**Files:**
- Modify: `server/src/db.rs:138-150`

**Interfaces:**
- Produces: `users.handle`, `users.bio`, `users.links`, `users.avatar_seed`, `users.suspended`, and a unique index on `handle`.

- [ ] **Step 1: Write the failing test**

Append to `server/src/db.rs`'s `mod tests`:

```rust
    fn users_columns(conn: &Connection) -> Vec<String> {
        let mut stmt = conn.prepare("PRAGMA table_info(users)").unwrap();
        stmt.query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .filter_map(Result::ok)
            .collect()
    }

    #[test]
    fn migration_adds_the_identity_columns() {
        let conn = Connection::open_in_memory().unwrap();
        init(&conn);
        let cols = users_columns(&conn);
        for c in ["handle", "bio", "links", "avatar_seed", "suspended"] {
            assert!(cols.contains(&c.to_string()), "missing users.{c}");
        }
    }

    // Uniqueness must be the DATABASE's job: two concurrent claims that both
    // pass an application-level "is it taken?" check would otherwise both win.
    #[test]
    fn two_accounts_cannot_share_a_handle() {
        let conn = Connection::open_in_memory().unwrap();
        init(&conn);
        conn.execute(
            "INSERT INTO users (email, pass_hash, created_at, handle) VALUES ('a@x','h',0,'taken')",
            [],
        )
        .unwrap();
        let second = conn.execute(
            "INSERT INTO users (email, pass_hash, created_at, handle) VALUES ('b@x','h',0,'taken')",
            [],
        );
        assert!(second.is_err(), "the unique index must reject a duplicate handle");
    }

    // NULL handles are the pre-claim state and there will be many of them.
    #[test]
    fn many_accounts_may_have_no_handle_yet() {
        let conn = Connection::open_in_memory().unwrap();
        init(&conn);
        conn.execute("INSERT INTO users (email, pass_hash, created_at) VALUES ('a@x','h',0)", []).unwrap();
        conn.execute("INSERT INTO users (email, pass_hash, created_at) VALUES ('b@x','h',0)", []).unwrap();
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --manifest-path server/Cargo.toml --lib`
Expected: FAIL — `missing users.handle`.

- [ ] **Step 3: Write the implementation**

In `migrate`, after the `display_name` line:

```rust
    ensure_column(conn, "users", "handle", "TEXT");
    ensure_column(conn, "users", "bio", "TEXT");
    ensure_column(conn, "users", "links", "TEXT NOT NULL DEFAULT '[]'");
    ensure_column(conn, "users", "avatar_seed", "TEXT");
    ensure_column(conn, "users", "suspended", "INTEGER NOT NULL DEFAULT 0");
    // Uniqueness is the database's job, not the handler's: two concurrent
    // claims that both pass an application "is it taken?" check would both
    // succeed. A partial index leaves the many pre-claim NULLs alone —
    // SQLite treats NULLs as distinct in a UNIQUE index anyway, but saying
    // it explicitly documents that unclaimed accounts are the normal case.
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS users_handle_unique
         ON users(handle) WHERE handle IS NOT NULL",
        [],
    )
    .expect("create users_handle_unique");
```

- [ ] **Step 4: Run the tests**

Run: `cargo test --manifest-path server/Cargo.toml`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/db.rs
git commit -m "feat(server): identity columns on users, unique handle index"
```

---

## Task 3: Account endpoints

**Files:**
- Create: `server/src/profiles.rs`, `server/tests/profiles.rs`
- Modify: `server/src/lib.rs`

**Interfaces:**
- Consumes: `handle::validate`, `auth::bearer_user`.
- Produces routes:
  - `GET /account` → `{email_masked, handle, displayName, bio, links, avatarSeed, suspended}`
  - `PATCH /account` → sets `displayName`, `bio`, `links`
  - `POST /account/handle` → `{handle}`; 409 if taken, 400 with a reason if invalid, 403 if already set

- [ ] **Step 1: Write the failing test**

Create `server/tests/profiles.rs` with a `register_and_login` helper that registers (dev mode returns the token), verifies, logs in, and returns the session token. Then:

```rust
#[tokio::test]
async fn claiming_a_handle_then_reading_it_back() { /* POST /account/handle then GET /account */ }

#[tokio::test]
async fn a_taken_handle_is_409() { /* two accounts, same handle */ }

#[tokio::test]
async fn an_invalid_handle_is_400_with_a_reason() { /* "ab" -> 400, body names the rule */ }

#[tokio::test]
async fn a_reserved_handle_is_rejected() { /* "admin" -> 400 */ }

#[tokio::test]
async fn a_handle_cannot_be_changed_once_set() { /* second claim -> 403 */ }

#[tokio::test]
async fn the_account_endpoint_never_returns_a_raw_email() { /* body has no '@' outside the mask */ }

#[tokio::test]
async fn bio_and_links_round_trip_and_are_capped() { /* 281 chars -> 400; 4 links -> 400; http:// -> 400 */ }
```

Write each body out in full when implementing; the assertions above are the contract.

- [ ] **Step 2: Implement**

Create `server/src/profiles.rs` with the three handlers. Rules enforced:

- `bio` ≤280 chars
- `links` ≤3 entries, each parsing as a URL with scheme `https`
- `display_name` ≤40 chars, trimmed, rejected if empty after trimming
- `avatar_seed` is set to the handle at claim time — deterministic identicons need no extra input
- a handle may be claimed once; changing it is an admin action (Phase 7)

Register the routes in `lib.rs`.

- [ ] **Step 3: Run the tests, then commit**

Run: `cargo test --manifest-path server/Cargo.toml`

```bash
git add server/src/profiles.rs server/src/lib.rs server/tests/profiles.rs
git commit -m "feat(server): account profile endpoints and handle claim"
```

---

## Task 4: Publishing requires a handle

**Files:**
- Modify: `server/src/submit.rs`
- Test: `server/tests/submit.rs` (append)

- [ ] **Step 1: Write the failing test**

```rust
#[tokio::test]
async fn publishing_without_a_handle_is_refused_with_a_reason() {
    // register + verify + login, do NOT claim a handle, then POST /submissions
    // Expect 403 and a body naming the handle requirement.
}
```

- [ ] **Step 2: Implement**

In `submit`, immediately after resolving `user_id`:

```rust
    // A handle is required to publish. Published work carries attribution on
    // every card and in the signed index, and "oli***" is not attribution —
    // this requirement is what turns display_name from a column nothing wrote
    // into a real one.
    let handle: Option<String> = state
        .db
        .lock()
        .query_row("SELECT handle FROM users WHERE id = ?1", [user_id], |r| r.get(0))
        .unwrap_or(None);
    if handle.is_none() {
        return Err((StatusCode::FORBIDDEN, "choose a handle before publishing".into()));
    }
```

Match the surrounding error type — read the function's signature first; if it returns bare `StatusCode`, return `Err(StatusCode::FORBIDDEN)` instead.

- [ ] **Step 3: Run, commit**

```bash
git add server/src/submit.rs server/tests/submit.rs
git commit -m "feat(server): require a handle before publishing"
```

---

## Task 5: `authorHandle` in the signed index

**Files:**
- Modify: `server/src/index.rs`
- Test: `server/tests/index.rs` (append)

- [ ] **Step 1: Write the failing test**

```rust
#[tokio::test]
async fn the_index_carries_the_author_handle() {
    // approved bundle whose author has handle 'oliver'
    // assert b["authorHandle"] == "oliver"
}

#[tokio::test]
async fn an_author_with_no_handle_yields_null_rather_than_an_empty_string() {
    // assert b["authorHandle"].is_null()
}
```

- [ ] **Step 2: Implement**

Add `u.handle` to the `SELECT` (append to the column list so existing positional
indexes do not shift), read it as `Option<String>`, and emit:

```rust
                    "authorHandle": handle,
```

**Do not use `.filter_map(Result::ok)` for the new column.** That pattern is
what turned a transient read error into a validly-signed empty catalog on
2026-08-04 and made 419 bundles vanish from every client. The existing call is
already there; do not add another.

- [ ] **Step 3: Run, commit**

```bash
git add server/src/index.rs server/tests/index.rs
git commit -m "feat(server): carry authorHandle in the signed index

Attribution rides the signed payload, so a card can link to a creator with no
second fetch and the link cannot be tampered with in transit."
```

---

## Phase 2 Done — Definition

- `cargo test --manifest-path server/Cargo.toml` passes, zero failures.
- A handle can be claimed once, is unique at the database level, and rejects reserved and malformed values with a readable reason.
- `GET /account` never returns a raw email address.
- `POST /submissions` is refused without a handle.
- `/index.json` carries `authorHandle`, null for authors who have not claimed one, and its signature still verifies.
