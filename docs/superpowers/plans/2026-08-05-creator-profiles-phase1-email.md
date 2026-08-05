# Creator Profiles — Phase 1: Email Delivery and Account Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make account verification real, so that every other control in 0.9.0 (rate limits, blocking, suspension) cannot be defeated by registering another account.

**Architecture:** The decision — *what should happen to this email* — becomes a pure, table-tested function returning one of three modes. The effect — actually talking to an SMTP relay — is injected, exactly as `ReviewFn` already injects the AI reviewer. Dev mode stops being the silent default and becomes an explicit opt-in that refuses to run against a public deployment.

**Tech Stack:** Rust, axum, rusqlite, `lettre` for SMTP.

## Global Constraints

- **Working directory is the repo root** for `cargo` commands against `server/Cargo.toml`.
- **This phase gates the entire release.** Nothing else in 0.9.0 is safe to expose until it lands — see the spec's "Prerequisite" section.
- **Never return a verification or reset token in an API response unless dev mode is explicitly enabled.** Returning one is equivalent to letting anyone self-verify unlimited accounts.
- **Existing behaviour must not regress:** `Config::test()` has `smtp_url: None` and every existing auth test relies on the token coming back in the response. Dev mode must stay the default *for tests* while ceasing to be the default *for deployments*.
- **Run `cargo test --manifest-path server/Cargo.toml` before every commit.**

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `server/src/email.rs` | Mode decision + SMTP send | **Create** |
| `server/src/state.rs` | `Config.dev_email`, `Config.public_base_url`, `Config.smtp_from` | Modify |
| `server/src/auth.rs` | Call the new seam instead of `email_or_log` | Modify |
| `server/src/lib.rs` | `pub mod email;` | Modify |
| `server/Cargo.toml` | `lettre` dependency | Modify |
| `server/tests/email_mode.rs` | Mode decision tests | **Create** |

---

## Task 1: The mode decision

**Files:**
- Create: `server/src/email.rs`
- Modify: `server/src/lib.rs`
- Test: `server/tests/email_mode.rs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `pub enum EmailMode { Smtp, DevReturnToken, Refuse }`
  - `pub fn email_mode(smtp_url: Option<&str>, dev_email: bool) -> EmailMode`

- [ ] **Step 1: Write the failing test**

Create `server/tests/email_mode.rs`:

```rust
use hub_marketplace::email::{email_mode, EmailMode};

#[test]
fn a_configured_relay_sends_mail() {
    assert_eq!(email_mode(Some("smtp://relay:25"), false), EmailMode::Smtp);
}

// The whole point of this phase. Before it, an unset SMTP_URL silently
// returned the verification token in the API response, which lets anyone
// self-verify unlimited accounts -- and email verification is the only
// sybil control in the 0.9.0 design.
#[test]
fn no_relay_and_no_explicit_dev_flag_refuses_rather_than_leaking_the_token() {
    assert_eq!(email_mode(None, false), EmailMode::Refuse);
}

#[test]
fn dev_mode_must_be_asked_for_explicitly() {
    assert_eq!(email_mode(None, true), EmailMode::DevReturnToken);
}

// A relay beats the dev flag: if mail can really be sent, send it. Otherwise
// a stray DEV_EMAIL=1 left in a unit file would silently reopen the hole.
#[test]
fn a_relay_wins_over_the_dev_flag() {
    assert_eq!(email_mode(Some("smtp://relay:25"), true), EmailMode::Smtp);
}

#[test]
fn an_empty_relay_url_is_not_a_relay() {
    assert_eq!(email_mode(Some(""), false), EmailMode::Refuse);
    assert_eq!(email_mode(Some("   "), true), EmailMode::DevReturnToken);
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --manifest-path server/Cargo.toml --test email_mode`
Expected: FAIL — `unresolved import hub_marketplace::email`.

- [ ] **Step 3: Write the implementation**

Create `server/src/email.rs`:

```rust
//! Outbound account email: verification and password reset.
//!
//! The DECISION (which of three things should happen to this message) is a
//! pure function, table-tested. The EFFECT (talking to a relay) is injected,
//! the same way `ReviewFn` injects the AI reviewer — so every branch is
//! testable without a mail server.
//!
//! Before 0.9.0 an unset `SMTP_URL` silently returned the verification token
//! in the API response. That was a deliberate contract for a friends-scale
//! service, and it is exactly wrong once strangers can register: it lets
//! anyone self-verify unlimited accounts, and email verification is the only
//! sybil control the design has. So "no relay" now REFUSES by default, and
//! returning tokens has to be asked for by name.

/// What should happen to an outbound account email.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EmailMode {
    /// A relay is configured: send it.
    Smtp,
    /// Explicitly-requested local development: return the token to the caller
    /// so a human can paste it. NEVER reachable without opting in.
    DevReturnToken,
    /// No relay and no opt-in: fail the request rather than hand out a token.
    Refuse,
}

/// `smtp_url` is `Config::smtp_url`, `dev_email` is `Config::dev_email`.
///
/// A configured relay always wins, so a `DEV_EMAIL=1` left behind in a unit
/// file cannot silently reopen the self-verification hole on a box that can
/// actually send mail.
pub fn email_mode(smtp_url: Option<&str>, dev_email: bool) -> EmailMode {
    let has_relay = smtp_url.map(|s| !s.trim().is_empty()).unwrap_or(false);
    if has_relay {
        EmailMode::Smtp
    } else if dev_email {
        EmailMode::DevReturnToken
    } else {
        EmailMode::Refuse
    }
}
```

Add to `server/src/lib.rs` beside the other `pub mod` lines:

```rust
pub mod email;
```

- [ ] **Step 4: Run the test**

Run: `cargo test --manifest-path server/Cargo.toml --test email_mode`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/email.rs server/src/lib.rs server/tests/email_mode.rs
git commit -m "feat(server): decide email delivery mode explicitly

An unset SMTP_URL used to return the verification token in the API response.
That was a defensible contract for a friends-scale service and is exactly
wrong once strangers can register: it lets anyone self-verify unlimited
accounts, and email verification is the only sybil control 0.9.0 has.

No relay now REFUSES by default; returning tokens must be asked for by name.
A configured relay beats the dev flag so a stray DEV_EMAIL=1 cannot silently
reopen the hole on a box that can really send mail."
```

---

## Task 2: Config gains the three new settings

**Files:**
- Modify: `server/src/state.rs:17-45`

**Interfaces:**
- Consumes: nothing.
- Produces: `Config.dev_email: bool`, `Config.public_base_url: String`, `Config.smtp_from: String`.

- [ ] **Step 1: Write the implementation**

There is no separate test: `Config::from_env` reads process environment, and the behaviour that matters is covered by Task 1's decision test and Task 4's integration tests. Adding fields is mechanical.

In `server/src/state.rs`, extend the struct:

```rust
#[derive(Clone)]
pub struct Config {
    pub port: u16,
    pub data_dir: std::path::PathBuf,
    pub admin_token: Option<String>,
    pub anthropic_api_key: Option<String>,
    pub smtp_url: Option<String>,
    /// Opt-in ONLY. When true and no relay is configured, verification and
    /// reset tokens come back in the API response. See email.rs for why this
    /// is no longer the default.
    pub dev_email: bool,
    /// Absolute base the links in outbound mail are built from, e.g.
    /// "https://market.basedsecurity.net". No trailing slash.
    pub public_base_url: String,
    /// Envelope From for outbound mail.
    pub smtp_from: String,
}
```

`from_env`:

```rust
            smtp_url: std::env::var("SMTP_URL").ok().filter(|s| !s.is_empty()),
            dev_email: std::env::var("DEV_EMAIL").map(|v| v == "1" || v.eq_ignore_ascii_case("true")).unwrap_or(false),
            public_base_url: std::env::var("PUBLIC_BASE_URL")
                .unwrap_or_else(|_| "https://market.basedsecurity.net".into())
                .trim_end_matches('/')
                .to_string(),
            smtp_from: std::env::var("SMTP_FROM")
                .unwrap_or_else(|_| "no-reply@basedsecurity.net".into()),
```

`Config::test()` — dev mode stays on for tests, which is what keeps every existing auth test passing:

```rust
            smtp_url: None,
            dev_email: true,
            public_base_url: "https://market.test".into(),
            smtp_from: "no-reply@market.test".into(),
```

Update the doc comment on `test()` to say `dev_email: true` explicitly.

- [ ] **Step 2: Run the whole suite**

Run: `cargo test --manifest-path server/Cargo.toml`
Expected: PASS. Every existing auth test still gets its token because `Config::test()` opts into dev mode.

- [ ] **Step 3: Commit**

```bash
git add server/src/state.rs
git commit -m "feat(server): DEV_EMAIL, PUBLIC_BASE_URL and SMTP_FROM config

Config::test() opts into dev email explicitly, which is what keeps the
existing auth tests passing while the DEPLOYMENT default flips to refusing."
```

---

## Task 3: Send real mail

**Files:**
- Modify: `server/Cargo.toml`, `server/src/email.rs`

**Interfaces:**
- Consumes: `EmailMode` (Task 1), `Config` (Task 2).
- Produces:
  - `pub fn verify_body(base_url: &str, token: &str) -> (String, String)` — (subject, body)
  - `pub fn reset_body(base_url: &str, token: &str) -> (String, String)`
  - `pub fn send(cfg: &crate::state::Config, to: &str, subject: &str, body: &str) -> Result<(), String>`

- [ ] **Step 1: Add the dependency**

In `server/Cargo.toml` under `[dependencies]`:

```toml
# SMTP for account verification and password reset. rustls rather than
# native-tls so the server has no OpenSSL build dependency, matching how
# ureq is already configured elsewhere in this workspace.
lettre = { version = "0.11", default-features = false, features = ["smtp-transport", "rustls-tls", "builder", "pool"] }
```

- [ ] **Step 2: Write the failing test**

Append to `server/tests/email_mode.rs`:

```rust
use hub_marketplace::email::{reset_body, verify_body};

#[test]
fn the_verify_link_is_absolute_and_carries_the_token() {
    let (subject, body) = verify_body("https://market.test", "abc123");
    assert!(subject.to_lowercase().contains("verify"));
    assert!(body.contains("https://market.test/auth/verify?token=abc123"));
}

#[test]
fn the_reset_link_is_absolute_and_carries_the_token() {
    let (_subject, body) = reset_body("https://market.test", "tok999");
    assert!(body.contains("https://market.test/auth/reset?token=tok999"));
}

// A trailing slash in PUBLIC_BASE_URL must not produce a double slash: some
// mail clients and proxies treat "//auth" as a different path.
#[test]
fn a_trailing_slash_in_the_base_url_does_not_double_up() {
    let (_s, body) = verify_body("https://market.test/", "t");
    assert!(!body.contains("//auth"));
}
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cargo test --manifest-path server/Cargo.toml --test email_mode`
Expected: FAIL — `verify_body` not found.

- [ ] **Step 4: Write the implementation**

Append to `server/src/email.rs`:

```rust
use crate::state::Config;

fn base(base_url: &str) -> &str {
    base_url.trim_end_matches('/')
}

/// (subject, plain-text body) for the verification mail.
pub fn verify_body(base_url: &str, token: &str) -> (String, String) {
    let link = format!("{}/auth/verify?token={}", base(base_url), token);
    (
        "Verify your 2ndMonitor marketplace account".to_string(),
        format!(
            "Welcome to the 2ndMonitor marketplace.\n\n\
             Confirm this address to finish creating your account:\n\n{link}\n\n\
             The link is valid for 24 hours. If you did not sign up, ignore \
             this message and no account will be created.\n"
        ),
    )
}

/// (subject, plain-text body) for the password reset mail.
pub fn reset_body(base_url: &str, token: &str) -> (String, String) {
    let link = format!("{}/auth/reset?token={}", base(base_url), token);
    (
        "Reset your 2ndMonitor marketplace password".to_string(),
        format!(
            "A password reset was requested for this address.\n\n{link}\n\n\
             The link is valid for 24 hours. If you did not request this, \
             ignore this message -- your password has not changed.\n"
        ),
    )
}

/// Blocking SMTP send. Called from a `spawn_blocking` context by the handler,
/// the same shape every other blocking call in this workspace uses.
///
/// Plain text only, deliberately: an HTML body would need escaping of
/// user-controlled content and buys nothing for two transactional messages.
pub fn send(cfg: &Config, to: &str, subject: &str, body: &str) -> Result<(), String> {
    use lettre::message::header::ContentType;
    use lettre::transport::smtp::authentication::Credentials;
    use lettre::{Message, SmtpTransport, Transport};

    let url = cfg.smtp_url.as_deref().unwrap_or_default();
    let parsed = url::Url::parse(url).map_err(|e| format!("SMTP_URL is not a URL: {e}"))?;

    let message = Message::builder()
        .from(cfg.smtp_from.parse().map_err(|e| format!("SMTP_FROM invalid: {e}"))?)
        .to(to.parse().map_err(|e| format!("recipient invalid: {e}"))?)
        .subject(subject)
        .header(ContentType::TEXT_PLAIN)
        .body(body.to_string())
        .map_err(|e| format!("could not build message: {e}"))?;

    let host = parsed.host_str().ok_or("SMTP_URL has no host")?;
    let mut transport = if parsed.scheme() == "smtps" {
        SmtpTransport::relay(host).map_err(|e| format!("relay: {e}"))?
    } else {
        SmtpTransport::starttls_relay(host).map_err(|e| format!("relay: {e}"))?
    };
    if let Some(port) = parsed.port() {
        transport = transport.port(port);
    }
    if !parsed.username().is_empty() {
        transport = transport.credentials(Credentials::new(
            parsed.username().to_string(),
            parsed.password().unwrap_or_default().to_string(),
        ));
    }

    transport
        .build()
        .send(&message)
        .map(|_| ())
        .map_err(|e| format!("send failed: {e}"))
}
```

Add `url = "2"` to `server/Cargo.toml` `[dependencies]` if not already present (check first with `grep '^url' server/Cargo.toml`).

- [ ] **Step 5: Run the tests**

Run: `cargo test --manifest-path server/Cargo.toml`
Expected: PASS, including the three new body tests.

- [ ] **Step 6: Commit**

```bash
git add server/Cargo.toml server/src/email.rs server/tests/email_mode.rs
git commit -m "feat(server): real SMTP delivery for verify and reset

lettre with rustls rather than native-tls, so the server keeps its
no-OpenSSL build. Plain text bodies only: an HTML body would need escaping
of user-controlled content and buys nothing for two transactional messages.

The link builder trims a trailing slash from PUBLIC_BASE_URL -- '//auth' is
a different path to some proxies and mail clients."
```

---

## Task 4: Wire it into register and reset

**Files:**
- Modify: `server/src/auth.rs:64-76` (replace `email_or_log`), `:110-125`, `:215-225`
- Test: `server/tests/auth.rs` (append)

**Interfaces:**
- Consumes: `email_mode`, `verify_body`, `reset_body`, `send`.
- Produces: unchanged public routes; `register` and `request_reset` now return `503` when `EmailMode::Refuse`.

- [ ] **Step 1: Write the failing test**

Append to `server/tests/auth.rs`. It needs a config with dev mode OFF, so build one explicitly rather than using `Config::test()`:

```rust
use hub_marketplace::state::Config;

/// Production-shaped config: no relay, no dev opt-in.
fn refusing_config() -> Config {
    let mut c = Config::test();
    c.dev_email = false;
    c
}

#[tokio::test]
async fn registration_refuses_when_no_mail_can_be_sent() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    let app = router(build_state(refusing_config(), conn, [7u8; 32]));

    let (status, body) = call(&app, "POST", "/auth/register", None,
        Some(serde_json::json!({"email":"a@example.com","password":"correct horse battery"}))).await;

    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE,
        "with no relay and no dev opt-in, registering must fail rather than hand back a token");
    assert!(body.get("verify_token").is_none(),
        "a refused registration must never leak a token");
}

#[tokio::test]
async fn dev_mode_still_returns_the_token_when_asked_for() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    let app = router(build_state(Config::test(), conn, [7u8; 32]));

    let (status, body) = call(&app, "POST", "/auth/register", None,
        Some(serde_json::json!({"email":"b@example.com","password":"correct horse battery"}))).await;

    assert_eq!(status, StatusCode::OK);
    assert!(body.get("verify_token").is_some(), "Config::test() opts into dev email");
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --manifest-path server/Cargo.toml --test auth`
Expected: FAIL — the refusing case currently returns 200 with no token.

- [ ] **Step 3: Write the implementation**

Replace `email_or_log` in `server/src/auth.rs` with:

```rust
/// Deliver an account email. Returns `Ok(Some(token))` only in explicitly
/// enabled dev mode, `Ok(None)` when a relay accepted it, and `Err` when
/// nothing can be delivered — in which case the caller MUST fail the request
/// rather than proceed, or it would create an account that can never verify.
fn deliver(state: &AppState, kind: &str, email: &str, token: &str) -> Result<Option<String>, StatusCode> {
    use crate::email::{email_mode, reset_body, send, verify_body, EmailMode};

    match email_mode(state.cfg.smtp_url.as_deref(), state.cfg.dev_email) {
        EmailMode::DevReturnToken => {
            println!("[dev-email] {kind} for {email}: token={token}");
            Ok(Some(token.to_string()))
        }
        EmailMode::Smtp => {
            let (subject, body) = if kind == "verify" {
                verify_body(&state.cfg.public_base_url, token)
            } else {
                reset_body(&state.cfg.public_base_url, token)
            };
            match send(&state.cfg, email, &subject, &body) {
                Ok(()) => Ok(None),
                Err(e) => {
                    // Loud, and a failure: silently swallowing this would
                    // leave the user staring at "check your email" forever.
                    eprintln!("[email] {kind} to {email} failed: {e}");
                    Err(StatusCode::SERVICE_UNAVAILABLE)
                }
            }
        }
        EmailMode::Refuse => {
            eprintln!(
                "[email] refusing to {kind} {email}: no SMTP_URL and DEV_EMAIL is not set. \
                 Returning the token would let anyone self-verify an account."
            );
            Err(StatusCode::SERVICE_UNAVAILABLE)
        }
    }
}
```

In `register`, replace the `email_or_log` call and its `match`:

```rust
    let dev_token = deliver(&state, "verify", &email, &token)?;
    Ok(Json(match dev_token {
        Some(t) => json!({ "ok": true, "verify_token": t }),
        None => json!({ "ok": true }),
    }))
```

Apply the same substitution in the reset handler, with `"reset"` and `reset_token`.

**Important:** in `register`, call `deliver` **before** committing the new user row if the row is inserted first — otherwise a refused send leaves an unverifiable account behind. If the insert already happens first in the current code, move the `deliver` call above it, or delete the row on `Err`. Read the surrounding function and pick whichever is the smaller change.

- [ ] **Step 4: Run the tests**

Run: `cargo test --manifest-path server/Cargo.toml`
Expected: PASS — all existing auth tests (which use `Config::test()`, dev mode on) plus the two new ones.

- [ ] **Step 5: Commit**

```bash
git add server/src/auth.rs server/tests/auth.rs
git commit -m "feat(server): refuse registration when no mail can be delivered

Previously an unset SMTP_URL returned the verification token in the response
and a SET SMTP_URL logged 'relay not integrated' and sent nothing -- so the
only two states were 'anyone can self-verify' and 'nobody can verify at all'.

Now: a relay sends, an explicit DEV_EMAIL returns the token, and anything
else is a 503 that says why. A send failure is also a 503 rather than a
silent success, because 'check your email' with no email is worse than an
error."
```

---

## Task 5: Document the deployment change

**Files:**
- Modify: `server/README.md`

- [ ] **Step 1: Write it**

Add a section documenting the four environment variables (`SMTP_URL`,
`SMTP_FROM`, `PUBLIC_BASE_URL`, `DEV_EMAIL`), an example `smtps://user:pass@host:465`
URL, and this sentence verbatim:

> Registration returns **503** until either `SMTP_URL` is configured or
> `DEV_EMAIL=1` is set. That is deliberate: before 0.9.0 an unconfigured
> server handed the verification token back in the API response, which lets
> anyone self-verify unlimited accounts. Email verification is the only sybil
> control the marketplace has, so an unconfigured server now refuses to
> register rather than pretending to.

Also update the stale claim in `server/src/auth.rs`'s module header (lines
5–8), which still describes the old contract.

- [ ] **Step 2: Commit**

```bash
git add server/README.md server/src/auth.rs
git commit -m "docs(server): document the email environment and the 503 contract"
```

---

## Phase 1 Done — Definition

- `cargo test --manifest-path server/Cargo.toml` passes with zero failures.
- With no `SMTP_URL` and no `DEV_EMAIL`, `POST /auth/register` returns 503 and no token appears in the body.
- With `DEV_EMAIL=1`, the existing dev flow is unchanged.
- With a real `SMTP_URL`, a verification mail arrives with an absolute link that verifies the account.
- `server/README.md` documents all four variables.

**Deployment note, not a code task:** the live server's systemd unit needs
`SMTP_URL`, `SMTP_FROM` and `PUBLIC_BASE_URL` added before it is redeployed,
or registration will 503 for everyone. That requires a relay credential the
repo does not and should not contain.

---

## Self-Review Notes

Checked against the spec's "Prerequisite: real email delivery" section:

- "verification tokens are returned in the API response" → Task 1 makes that a
  named, opt-in mode; Task 4 makes the default a 503.
- "real email delivery must land before the community opens" → Tasks 2–4.
- "it is Phase 1" → this document.

**One thing deliberately not done:** no HTML mail, no templating engine, no
queue or retry. A failed send is a 503 the user can act on by pressing the
button again, which is the correct amount of machinery for two transactional
messages on a service with one account today.
