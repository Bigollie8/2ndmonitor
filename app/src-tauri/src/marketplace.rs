//! Marketplace client: fetch the ed25519-signed index from the user's server,
//! verify signatures and per-bundle SHA-256, and install approved bundles into
//! the phase-1/2 content stores (presets/, visualizers/). Also `broker_fetch`,
//! the https-only, size-capped fetch the sandbox permission broker performs on
//! behalf of installed tiles.
//!
//! Trust: the app pins the server's public key (pasted once by the user). An
//! index whose signature doesn't verify, or a bundle whose hash doesn't match
//! the signed index, is refused. Zip extraction is allowlisted to known entry
//! names so a malicious archive can't write outside the target folder.

use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, Runtime};

const FETCH_CAP: usize = 1_048_576; // 1 MiB — enforced ceiling for the index fetch, via get_capped.
// 4 MiB per bundle — enforced ceiling for a bundle download, via get_capped
// (see marketplace_install). Until get_capped grew a caller-supplied cap
// (see its doc comment), this constant was checked AFTER a fetch that had
// already hard-capped at FETCH_CAP internally, making the check below dead:
// no bundle could ever arrive bigger than 1 MiB, so it could never trip.
// `caps_are_ordered_and_pinned_to_their_exact_values` (in tests) pins
// FETCH_CAP < ZIP_CAP so a future edit can't silently re-shrink this.
const ZIP_CAP: usize = 4_194_304;
// A preview is a catalog thumbnail, not a bundle — it must not be able to
// consume the same 4 MiB a bundle may. Must stay smaller than ZIP_CAP; see
// `preview_cap_is_smaller_than_the_bundle_cap` below, which pins that.
const PREVIEW_CAP: usize = 262_144; // 256 KiB
/// A media asset may be an animation, which the server caps at 2 MB — see
/// server/src/media.rs. Still larger than PREVIEW_CAP for exactly that
/// reason, and still well under ZIP_CAP.
const MEDIA_CAP: usize = 2 * 1024 * 1024;

/// Mirror of the server's `keys::verify_index` — the signature covers the exact
/// serialized `bundles` array substring, verified verbatim.
pub fn verify_index(bundles_json: &str, sig_hex: &str, pubkey_hex: &str) -> bool {
    let Ok(pk_bytes) = hex::decode(pubkey_hex) else { return false };
    let Ok(pk_arr) = <[u8; 32]>::try_from(pk_bytes.as_slice()) else { return false };
    let Ok(pk) = VerifyingKey::from_bytes(&pk_arr) else { return false };
    let Ok(sig_bytes) = hex::decode(sig_hex) else { return false };
    let Ok(sig_arr) = <[u8; 64]>::try_from(sig_bytes.as_slice()) else { return false };
    pk.verify(bundles_json.as_bytes(), &Signature::from_bytes(&sig_arr)).is_ok()
}

/// Pull the raw `"bundles":[...]` array substring out of the index body so it
/// can be verified byte-for-byte against the signature.
fn extract_bundles_str(raw: &str) -> Option<&str> {
    let key = "\"bundles\":";
    let start = raw.find(key)? + key.len();
    let rest = &raw[start..];
    let end = rest.rfind(",\"pubkey\"")?;
    Some(&rest[..end])
}

/// Size-capped HTTPS fetch shared by the index, bundle, and preview fetches.
///
/// `cap` is the CALLER's to choose, not a constant hardcoded in here — every
/// call site names its own module-level constant: `marketplace_fetch_index`
/// passes `FETCH_CAP`, `marketplace_install` passes `ZIP_CAP`,
/// `marketplace_fetch_preview` passes `PREVIEW_CAP`. Do not reintroduce a
/// hardcoded cap here: this function previously enforced `FETCH_CAP`
/// unconditionally regardless of what the caller intended, which silently
/// capped every bundle download at 1 MiB and made `marketplace_install`'s
/// `ZIP_CAP` (4 MiB) check unreachable dead code — any bundle over 1 MiB
/// would have failed here first, with a misleading "response too large"
/// rather than the intended 4 MiB ceiling.
fn get_capped(url: &str, cap: usize) -> Result<Vec<u8>, String> {
    if !url.starts_with("https://") {
        return Err("only https URLs are allowed".into());
    }
    let resp = ureq::get(url)
        .timeout(std::time::Duration::from_secs(10))
        .call()
        .map_err(|e| format!("request failed: {e}"))?;
    let mut buf = Vec::new();
    resp.into_reader()
        .take((cap + 1) as u64)
        .read_to_end(&mut buf)
        .map_err(|e| format!("read failed: {e}"))?;
    if buf.len() > cap {
        return Err("response too large".into());
    }
    Ok(buf)
}

// ---------------------------------------------------------------------------
// Sign-in: POST /auth/login, session token in the DPAPI secret store.
//
// The token is a credential and is handled exactly like every other one this
// app stores (github_pat, ha_token, ...): through secrets.rs's DPAPI-backed
// store, NEVER localStorage. `marketplace_login` returns `Result<(), String>`
// — nothing on success — and `marketplace_session_status` exposes only a bool
// plus a PRE-MASKED email (masked here at write time, the same way index.rs
// masks bundle authors, so there is no unmasked copy anywhere for a later bug
// to accidentally serialize).
//
// CORRECTION (post D2-review): an earlier version of this comment, and of
// the Task 2 report, claimed the token was "NEVER returned across the IPC
// boundary to the frontend". That was FALSE as originally shipped.
// secrets.rs's `secret_get` is a generic `#[tauri::command]`, already in the
// allowlist for legitimate uses (github_pat, ha_token, per-bundle secrets),
// and it took an arbitrary caller-supplied key with no reserved list — so
// `invoke('secret_get', { key: 'marketplace_session' })`, issued from the
// main webview exactly like any other secret read, returned the
// DPAPI-decrypted session token in plain text. The ACL scoped that call to
// webview `main` + `Origin::Local` (so the browser tile / sandboxed frame
// couldn't reach it), and no shipped frontend code requested that key — but
// "no shipped code does it" is not "the token can never leave Rust", which is
// what the comment claimed.
//
// That gap is now closed in secrets.rs: `marketplace_session` is a RESERVED
// key (see `secrets::RESERVED_KEYS`), rejected by the `secret_get`/
// `secret_set`/`secret_delete` command wrappers before the store is ever
// touched — pinned by a test that reads secrets.rs's own source to confirm
// the guard runs before the inner store call, not just that the guard
// predicate itself is correct. This module now reaches the store through
// `secret_get_inner`/`secret_set_inner`/`secret_delete_inner` below — plain
// Rust functions, not commands, unreachable over IPC under any key — which is
// what actually makes "never returned to the frontend" true rather than
// merely intended. Every future command that needs the token (rating
// submission, Task 3) must do the same: read it Rust-side via
// `secrets::secret_get_inner`, never accept it as a parameter from the
// frontend, and never round-trip it through the generic `secret_get` command.
// ---------------------------------------------------------------------------

/// Fixed key the session lives under in the shared secrets.json store. Its
/// value is a small JSON blob — `{"token": "...", "email_masked": "..."}` —
/// so a single secret_get/secret_set pair covers both fields; there is no
/// unmasked email stored anywhere.
const SESSION_SECRET_KEY: &str = "marketplace_session";

// 8 KiB — enforced ceiling for the /auth/login response, which is either a
// small `{"token": "..."}` object or an empty error body. Deliberately its
// own constant rather than reusing FETCH_CAP (1 MiB, sized for the index) —
// a login response has no business being anywhere near that large.
const AUTH_CAP: usize = 8_192;

/// Masks an email exactly the way the server masks bundle authors in the
/// signed index (`server/src/index.rs`: `format!("{}***", email.chars()
/// .take(3)...)`). Applied here, before the value ever reaches the secret
/// store, so the ONLY email-shaped string this app ever persists is already
/// irreversibly truncated — there is no unmasked copy for `secret_get` to
/// leak later even by accident.
fn mask_email(email: &str) -> String {
    format!("{}***", email.chars().take(3).collect::<String>())
}

/// Maps a `/auth/login` HTTP status to a human-readable message, or `None`
/// for success (200). Pulled out as a pure function so the status→message
/// mapping — the whole reason this task exists ("a wrong password and an
/// unreachable server are different problems") — is unit-testable without a
/// live server. A transport-level failure (offline, DNS, refused) never
/// reaches this function at all; it fails inside `post_capped_json` with its
/// own distinct message, which is exactly the point.
fn login_status_message(status: u16) -> Option<String> {
    match status {
        200 => None,
        401 => Some("incorrect email or password".into()),
        403 => Some("account not verified — check your email for the verification link".into()),
        429 => Some("too many sign-in attempts — wait a minute and try again".into()),
        other => Some(format!("marketplace server returned HTTP {other}")),
    }
}

/// POST-with-JSON-body counterpart to `get_capped`, used by
/// `marketplace_login` and `marketplace_rate`. `get_capped` treats ANY
/// non-2xx as a single opaque "request failed" transport error (ureq's
/// default), which is exactly wrong here: the caller needs to tell a 401
/// (wrong password, or — for `marketplace_rate` — no/expired session) apart
/// from a connection that never completed at all (unreachable server) so the
/// two can produce different messages. So this function surfaces
/// status/body for EVERY response that actually completed — 2xx or not —
/// and reserves the `Err` return for a genuine transport failure.
/// `login_status_message`/`rate_status_message` are the caller-side
/// decisions that turn the status into user-facing text.
///
/// `bearer` is `None` for the unauthenticated login POST, `Some(token)` for
/// `marketplace_rate` — the ONLY place that token is ever attached to an
/// outgoing request. It is read Rust-side via `secrets::secret_get_inner`
/// by the caller and passed in as a borrow here; this function does not
/// store, log, or otherwise retain it beyond building the one header.
fn post_capped_json(
    url: &str,
    body: &serde_json::Value,
    cap: usize,
    bearer: Option<&str>,
) -> Result<(u16, Vec<u8>), String> {
    if !url.starts_with("https://") {
        return Err("only https URLs are allowed".into());
    }
    fn read_capped(resp: ureq::Response, cap: usize) -> Result<Vec<u8>, String> {
        let mut buf = Vec::new();
        resp.into_reader()
            .take((cap + 1) as u64)
            .read_to_end(&mut buf)
            .map_err(|e| format!("read failed: {e}"))?;
        if buf.len() > cap {
            return Err("response too large".into());
        }
        Ok(buf)
    }
    // redirects(0): mirrors broker_fetch's SSRF-defense reasoning (see its
    // doc comment). ureq's default agent follows up to 5 redirects with no
    // scheme check; an https:// login endpoint that 302s to http://... or a
    // LAN address would otherwise have this client silently follow it, and
    // the response would be parsed as the login result. The password itself
    // is not at risk that way — a POST redirect (301/302/303) rewrites to GET
    // and drops the body, and 307/308 aren't followed by ureq's redirect
    // handling either — but the "https enforced" check above is only
    // meaningful for the request this function actually issues; without
    // this, it would say nothing about where the response that decides
    // `token` came from. With redirects(0) a 3xx just comes back as an
    // ordinary status this function already handles like any other non-200.
    // The same reasoning applies to `marketplace_rate`'s bearer token: a
    // redirect silently followed to an attacker-controlled host would carry
    // the `Authorization` header wherever `Location` points.
    let agent = ureq::AgentBuilder::new().redirects(0).build();
    let mut req = agent.post(url).timeout(std::time::Duration::from_secs(10));
    if let Some(token) = bearer {
        req = req.set("Authorization", &format!("Bearer {token}"));
    }
    match req.send_json(body.clone()) {
        Ok(resp) => {
            let status = resp.status();
            Ok((status, read_capped(resp, cap)?))
        }
        Err(ureq::Error::Status(code, resp)) => Ok((code, read_capped(resp, cap)?)),
        Err(ureq::Error::Transport(t)) => Err(format!("request failed: {t}")),
    }
}

/// The stored session token, or a fail-fast error. Mirrors the read
/// `marketplace_rate` does: the token is resolved Rust-side from the DPAPI/
/// Keychain-backed secret store and is never accepted as a command parameter,
/// so the frontend cannot supply (or leak) one.
fn session_token<R: Runtime>(app: &AppHandle<R>) -> Result<String, String> {
    let raw = crate::secrets::secret_get_inner(app, SESSION_SECRET_KEY)
        .ok_or_else(|| "not signed in".to_string())?;
    serde_json::from_str::<serde_json::Value>(&raw)
        .ok()
        .and_then(|v| v.get("token").and_then(|t| t.as_str()).map(str::to_string))
        .ok_or_else(|| "not signed in".to_string())
}

/// Authenticated GET. Same https-only and redirects(0) reasoning as
/// `post_capped_json` — a followed redirect would carry the Authorization
/// header to wherever `Location` pointed.
fn get_capped_auth(url: &str, cap: usize, bearer: &str) -> Result<(u16, Vec<u8>), String> {
    if !url.starts_with("https://") {
        return Err("only https URLs are allowed".into());
    }
    fn read_capped(resp: ureq::Response, cap: usize) -> Result<Vec<u8>, String> {
        let mut buf = Vec::new();
        resp.into_reader()
            .take((cap + 1) as u64)
            .read_to_end(&mut buf)
            .map_err(|e| format!("read failed: {e}"))?;
        if buf.len() > cap {
            return Err("response too large".into());
        }
        Ok(buf)
    }
    let agent = ureq::AgentBuilder::new().redirects(0).build();
    match agent
        .get(url)
        .timeout(std::time::Duration::from_secs(10))
        .set("Authorization", &format!("Bearer {bearer}"))
        .call()
    {
        Ok(resp) => {
            let status = resp.status();
            Ok((status, read_capped(resp, cap)?))
        }
        Err(ureq::Error::Status(code, resp)) => Ok((code, read_capped(resp, cap)?)),
        Err(ureq::Error::Transport(t)) => Err(format!("request failed: {t}")),
    }
}

/// Authenticated PATCH, same contract as `post_capped_json`.
fn patch_capped_json(
    url: &str,
    body: &serde_json::Value,
    cap: usize,
    bearer: &str,
) -> Result<(u16, Vec<u8>), String> {
    if !url.starts_with("https://") {
        return Err("only https URLs are allowed".into());
    }
    fn read_capped(resp: ureq::Response, cap: usize) -> Result<Vec<u8>, String> {
        let mut buf = Vec::new();
        resp.into_reader()
            .take((cap + 1) as u64)
            .read_to_end(&mut buf)
            .map_err(|e| format!("read failed: {e}"))?;
        if buf.len() > cap {
            return Err("response too large".into());
        }
        Ok(buf)
    }
    let agent = ureq::AgentBuilder::new().redirects(0).build();
    match agent
        .request("PATCH", url)
        .timeout(std::time::Duration::from_secs(10))
        .set("Authorization", &format!("Bearer {bearer}"))
        .send_json(body.clone())
    {
        Ok(resp) => {
            let status = resp.status();
            Ok((status, read_capped(resp, cap)?))
        }
        Err(ureq::Error::Status(code, resp)) => Ok((code, read_capped(resp, cap)?)),
        Err(ureq::Error::Transport(t)) => Err(format!("request failed: {t}")),
    }
}

/// Creates an account. Returns the dev-mode verification token when the
/// server is configured to hand one back, and `null` when it sent a real
/// email instead — the caller uses that to decide whether it can finish the
/// flow itself or has to say "check your email".
///
/// `password` is used only to build the outgoing request body and is dropped
/// when this function returns, exactly as in `marketplace_login` below.
#[tauri::command]
pub fn marketplace_register(
    url: String,
    email: String,
    password: String,
) -> Result<serde_json::Value, String> {
    let base = url.trim_end_matches('/');
    let body = serde_json::json!({ "email": email, "password": password });
    let (status, buf) = post_capped_json(&format!("{base}/auth/register"), &body, AUTH_CAP, None)?;
    let text = String::from_utf8_lossy(&buf).into_owned();

    if !(200..300).contains(&status) {
        // 503 is the server saying it cannot deliver mail, which is its way
        // of refusing to create an account nobody could ever verify. Say that
        // rather than showing a bare status code.
        if status == 503 {
            return Err(
                "the marketplace is not accepting new accounts right now (it cannot send                  verification email)"
                    .into(),
            );
        }
        if status == 409 {
            return Err("an account already exists for that address".into());
        }
        return Err(if text.trim().is_empty() { format!("HTTP {status}") } else { text });
    }

    let parsed: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("register response not JSON: {e}"))?;
    Ok(serde_json::json!({
        "verifyToken": parsed.get("verify_token").and_then(|t| t.as_str()),
    }))
}

/// Confirms an address with the token from the verification email — or, in
/// dev mode, the one `marketplace_register` just handed back.
#[tauri::command]
pub fn marketplace_verify_account(url: String, token: String) -> Result<(), String> {
    if token.trim().is_empty() {
        return Err("verification token required".into());
    }
    let base = url.trim_end_matches('/');
    let endpoint = format!("{base}/auth/verify?token={}", urlencoding::encode(token.trim()));
    let (status, buf) = get_capped_status(&endpoint, AUTH_CAP)?;
    if !(200..300).contains(&status) {
        let text = String::from_utf8_lossy(&buf).into_owned();
        return Err(if status == 404 {
            "that verification link has expired or was already used".into()
        } else if text.trim().is_empty() {
            format!("HTTP {status}")
        } else {
            text
        });
    }
    Ok(())
}

/// Unauthenticated GET that reports the status rather than erroring on 4xx —
/// verification needs to tell an expired link apart from a network failure.
fn get_capped_status(url: &str, cap: usize) -> Result<(u16, Vec<u8>), String> {
    if !url.starts_with("https://") {
        return Err("only https URLs are allowed".into());
    }
    fn read_capped(resp: ureq::Response, cap: usize) -> Result<Vec<u8>, String> {
        let mut buf = Vec::new();
        resp.into_reader()
            .take((cap + 1) as u64)
            .read_to_end(&mut buf)
            .map_err(|e| format!("read failed: {e}"))?;
        if buf.len() > cap {
            return Err("response too large".into());
        }
        Ok(buf)
    }
    let agent = ureq::AgentBuilder::new().redirects(0).build();
    match agent.get(url).timeout(std::time::Duration::from_secs(10)).call() {
        Ok(resp) => {
            let status = resp.status();
            Ok((status, read_capped(resp, cap)?))
        }
        Err(ureq::Error::Status(code, resp)) => Ok((code, read_capped(resp, cap)?)),
        Err(ureq::Error::Transport(t)) => Err(format!("request failed: {t}")),
    }
}

/// Signs in against the marketplace server and stores the session token.
///
/// Returns nothing on success — see the module-level comment above for why.
/// `password` is used only to build the outgoing HTTPS request body (the
/// login submission IS the credential channel) and to hash-compare nothing
/// else; it is never logged, never included in an error message, and is
/// dropped when this function returns.
#[tauri::command]
pub fn marketplace_login<R: Runtime>(
    app: AppHandle<R>,
    url: String,
    email: String,
    password: String,
) -> Result<(), String> {
    let base = url.trim_end_matches('/');
    let endpoint = format!("{base}/auth/login");
    let body = serde_json::json!({ "email": email, "password": password });
    let (status, buf) = post_capped_json(&endpoint, &body, AUTH_CAP, None)?;
    if let Some(msg) = login_status_message(status) {
        return Err(msg);
    }
    let v: serde_json::Value =
        serde_json::from_slice(&buf).map_err(|_| "login response was not JSON".to_string())?;
    let token = v
        .get("token")
        .and_then(|t| t.as_str())
        .ok_or("login response missing a token")?;
    let stored = serde_json::json!({
        "token": token,
        "email_masked": mask_email(&email),
    })
    .to_string();
    crate::secrets::secret_set_inner(&app, SESSION_SECRET_KEY, &stored)
}

/// Clears the stored session. Idempotent — signing out when already signed
/// out is not an error (mirrors `secret_delete_inner`'s own idempotence).
#[tauri::command]
pub fn marketplace_logout<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    crate::secrets::secret_delete_inner(&app, SESSION_SECRET_KEY)
}

/// What the frontend is allowed to know about the session: whether one
/// exists, and a display-only masked email. This type has no token field,
/// which is worth keeping true as defense in depth — but the type shape was
/// never the actual enforcement point, and an earlier version of this
/// comment overstated it as one ("nothing here for a future edit to
/// accidentally wire up and leak"). What actually stops the token reaching
/// the frontend is `secrets::secret_get`'s reserved-key guard (see the
/// CORRECTION note at the top of this section) plus this command reading the
/// store via `secret_get_inner`, not this struct's shape.
#[derive(Serialize)]
pub struct MarketplaceSessionStatus {
    #[serde(rename = "signedIn")]
    pub signed_in: bool,
    pub email: Option<String>,
}

/// True when a stored session blob parses and carries a non-empty `token`.
/// Pulled out as a pure function — no AppHandle, no I/O — so a corrupt or
/// half-written blob is unit-testable without touching the DPAPI store.
/// Without this check, `marketplace_session_status` reported `signedIn: true`
/// for ANY present value under the session key, parseable or not — which
/// would show a signed-in UI with no way to diagnose why every rating
/// submission then failed.
///
/// Deliberately does NOT check expiry (the server's 30-day session TTL,
/// `auth.rs::SESSION_TTL`) — this app has no way to validate a token without
/// a network round-trip, and Task 3's first authenticated call will get a 401
/// for a genuinely expired token. This function only catches "the blob
/// itself is useless", not "the token it names might no longer be honoured".
fn session_blob_has_token(raw: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(raw)
        .ok()
        .and_then(|v| v.get("token").and_then(|t| t.as_str()).map(|s| !s.is_empty()))
        .unwrap_or(false)
}

/// Cheap, local, no network: just "does a token exist in the store". The
/// email returned is the masked value written at login time — see
/// `mask_email` — never the raw one.
#[tauri::command]
pub fn marketplace_session_status<R: Runtime>(
    app: AppHandle<R>,
) -> Result<MarketplaceSessionStatus, String> {
    let Some(raw) = crate::secrets::secret_get_inner(&app, SESSION_SECRET_KEY) else {
        return Ok(MarketplaceSessionStatus { signed_in: false, email: None });
    };
    if !session_blob_has_token(&raw) {
        return Ok(MarketplaceSessionStatus { signed_in: false, email: None });
    }
    let email = serde_json::from_str::<serde_json::Value>(&raw)
        .ok()
        .and_then(|v| v.get("email_masked").and_then(|e| e.as_str()).map(str::to_string));
    Ok(MarketplaceSessionStatus { signed_in: true, email })
}

// ---------------------------------------------------------------------------
// Ratings: GET /ratings is public, unsigned browse data (see server/src/
// ratings.rs's module doc) — fetched through get_capped exactly like the
// index, but never signature-verified, because it isn't part of the signed
// payload at all. A failure here is silent by design: the catalog renders
// unchanged with every item's rating simply absent (see
// state/catalog.ts's MergeCatalogArgs.ratings), same treatment as a missing
// preview image. POST /ratings (marketplace_rate) is the one authenticated
// call in this section — it reads the session token Rust-side via
// `secrets::secret_get_inner`, the same pattern the CORRECTION note atop the
// sign-in section above documents, and NEVER accepts a token from the
// frontend or returns one.
// ---------------------------------------------------------------------------

/// True for an in-range integer rating. Pure so the boundary values (0, 1,
/// 5, 6) are covered without a live server or an `AppHandle` — mirrors the
/// server's own `ratings::validate_stars` range check; the type-validity half
/// of that function (rejecting `3.5`/`"5"`/`null`) has no equivalent needed
/// here because Tauri's IPC layer already deserializes `stars` into a real
/// `i64` before this command's body ever runs, unlike the server which reads
/// raw JSON off the wire.
fn stars_in_range(stars: i64) -> bool {
    (1..=5).contains(&stars)
}

/// Maps a `/ratings` POST response to a caller-facing error, or `None` for
/// success (200). Pulled out as a pure function, same shape as
/// `login_status_message` — but unlike login, the server's failure bodies
/// here ARE genuinely useful plain text (see server/src/ratings.rs: "stars
/// must be an integer from 1 to 5", "bundle does not exist or is not
/// approved", "auth required" for a missing/expired session), so this
/// forwards `body` verbatim rather than inventing a second copy of the same
/// messages, and only substitutes a generic one when the body is empty or
/// unreadable as UTF-8 text.
fn rate_status_message(status: u16, body: &str) -> Option<String> {
    if status == 200 {
        return None;
    }
    if !body.is_empty() {
        return Some(body.to_string());
    }
    Some(format!("marketplace server returned HTTP {status}"))
}

/// Fetches the current aggregate ratings for every rated bundle — `{"<bundle_
/// id>": {"avg": 4.2, "count": 17}}`. Unsigned and public: no pubkey
/// parameter, no signature check, unlike `marketplace_fetch_index`. Callers
/// must treat any `Err` exactly like a missing preview (silent, see the
/// module comment above) — this function itself has no special-casing for
/// that; it is ordinary `get_capped` error propagation.
/// Async + `spawn_blocking`: a sync `#[tauri::command]` runs on the MAIN
/// thread, and this one does a blocking HTTP GET with a 10s timeout — that
/// combination freezes the whole UI for the duration of the fetch. Same
/// conversion as `marketplace_fetch_index` and `marketplace_fetch_preview`
/// below; the preview command is the one that made this visible (the catalog
/// mounts hundreds of preview fetches at once), but any of the three blocking
/// on a slow server stalled the app.
#[tauri::command]
pub async fn marketplace_fetch_ratings(url: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let base = url.trim_end_matches('/');
        let body_bytes = get_capped(&format!("{base}/ratings"), FETCH_CAP)?;
        let body = String::from_utf8(body_bytes).map_err(|_| "ratings not UTF-8".to_string())?;
        serde_json::from_str(&body).map_err(|e| format!("ratings not JSON: {e}"))
    })
    .await
    .map_err(|e| format!("fetch task failed: {e}"))?
}

/// Written reviews for one bundle. Unsigned and public, exactly like
/// `marketplace_fetch_ratings`, and on the same silent-failure contract:
/// callers treat any `Err` as "no reviews", never as an error worth
/// interrupting a user over.
#[tauri::command]
pub async fn marketplace_fetch_reviews(url: String, id: String) -> Result<serde_json::Value, String> {
    if !is_safe_id(&id) {
        return Err("invalid bundle id".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let base = url.trim_end_matches('/');
        let endpoint = format!("{base}/reviews?id={id}");
        let body_bytes = get_capped(&endpoint, FETCH_CAP)?;
        let body = String::from_utf8(body_bytes).map_err(|_| "reviews not UTF-8".to_string())?;
        serde_json::from_str(&body).map_err(|e| format!("reviews not JSON: {e}"))
    })
    .await
    .map_err(|e| format!("fetch task failed: {e}"))?
}

/// Posts (or replaces — the server's `(bundle_id, user_id)` primary key means
/// a second review from this account REPLACES rather than stacks, see
/// server/src/reviews.rs) a written review.
///
/// The session token is read Rust-side via `secrets::secret_get_inner` and
/// attached inside `post_capped_json`, exactly as `marketplace_rate` does —
/// it is never a parameter of this command and never appears in its return.
///
/// Unlike the fetch above, a failure here MUST reach the user: they typed
/// something and deserve to know it did not land.
#[tauri::command]
pub fn marketplace_post_review<R: Runtime>(
    app: AppHandle<R>,
    url: String,
    id: String,
    body: String,
) -> Result<(), String> {
    if !is_safe_id(&id) {
        return Err("invalid bundle id".into());
    }
    if body.trim().is_empty() {
        return Err("review body must not be blank".into());
    }
    if body.chars().count() > 1000 {
        return Err("review must be at most 1000 characters".into());
    }
    let raw = crate::secrets::secret_get_inner(&app, SESSION_SECRET_KEY)
        .ok_or_else(|| "not signed in".to_string())?;
    let token = serde_json::from_str::<serde_json::Value>(&raw)
        .ok()
        .and_then(|v| v.get("token").and_then(|t| t.as_str()).map(str::to_string))
        .ok_or_else(|| "not signed in".to_string())?;

    let base = url.trim_end_matches('/');
    let endpoint = format!("{base}/reviews");
    let payload = serde_json::json!({ "id": id, "body": body });
    let (status, buf) = post_capped_json(&endpoint, &payload, AUTH_CAP, Some(&token))?;
    if !(200..300).contains(&status) {
        let text = String::from_utf8_lossy(&buf).into_owned();
        return Err(if text.trim().is_empty() {
            format!("review failed: HTTP {status}")
        } else {
            text
        });
    }
    Ok(())
}

/// The creator directory, optionally searched. Public: a signed-out browse
/// still gets the full list, because discovering people is the point.
#[tauri::command]
pub fn marketplace_fetch_creators(
    url: String,
    query: Option<String>,
) -> Result<serde_json::Value, String> {
    let base = url.trim_end_matches('/');
    let q = query.unwrap_or_default();
    let endpoint = if q.trim().is_empty() {
        format!("{base}/creators")
    } else {
        format!("{base}/creators?q={}", urlencoding::encode(q.trim()))
    };
    let (status, buf) = get_capped_status(&endpoint, FETCH_CAP)?;
    let text = String::from_utf8_lossy(&buf).into_owned();
    if !(200..300).contains(&status) {
        return Err(if text.trim().is_empty() { format!("HTTP {status}") } else { text });
    }
    serde_json::from_str(&text).map_err(|e| format!("not JSON: {e}"))
}

/// Forum topics, optionally scoped to one bundle's discussion.
#[tauri::command]
pub fn marketplace_fetch_topics<R: Runtime>(
    app: AppHandle<R>,
    url: String,
    bundle_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let base = url.trim_end_matches('/');
    let endpoint = match bundle_id.as_deref().filter(|b| !b.is_empty()) {
        Some(b) => {
            if !is_safe_id(b) {
                return Err("invalid bundle id".into());
            }
            format!("{base}/topics?bundleId={b}")
        }
        None => format!("{base}/topics"),
    };
    get_social(&endpoint, session_token(&app).ok())
}

#[tauri::command]
pub fn marketplace_create_topic<R: Runtime>(
    app: AppHandle<R>,
    url: String,
    title: String,
    body: String,
    bundle_id: Option<String>,
) -> Result<(), String> {
    if title.trim().is_empty() || body.trim().is_empty() {
        return Err("a topic needs a title and a body".into());
    }
    if title.chars().count() > 120 {
        return Err("title must be at most 120 characters".into());
    }
    if body.chars().count() > 4000 {
        return Err("body must be at most 4000 characters".into());
    }
    let base = url.trim_end_matches('/');
    let mut payload = serde_json::json!({ "title": title, "body": body });
    if let Some(b) = bundle_id.filter(|b| !b.is_empty()) {
        if !is_safe_id(&b) {
            return Err("invalid bundle id".into());
        }
        payload["bundleId"] = serde_json::Value::String(b);
    }
    post_social(&app, &format!("{base}/topics"), &payload)
}

#[tauri::command]
pub fn marketplace_fetch_replies<R: Runtime>(
    app: AppHandle<R>,
    url: String,
    topic_id: i64,
) -> Result<serde_json::Value, String> {
    let base = url.trim_end_matches('/');
    get_social(&format!("{base}/topics/replies?topicId={topic_id}"), session_token(&app).ok())
}

#[tauri::command]
pub fn marketplace_create_reply<R: Runtime>(
    app: AppHandle<R>,
    url: String,
    topic_id: i64,
    body: String,
) -> Result<(), String> {
    if body.trim().is_empty() {
        return Err("reply must not be blank".into());
    }
    if body.chars().count() > 4000 {
        return Err("reply must be at most 4000 characters".into());
    }
    let base = url.trim_end_matches('/');
    post_social(&app, &format!("{base}/topics/replies"),
        &serde_json::json!({ "topicId": topic_id, "body": body }))
}

/// The shoutbox window. Polled by the client, so this stays cheap and never
/// errors loudly — a dead fetch leaves the last window on screen.
#[tauri::command]
pub fn marketplace_fetch_shouts<R: Runtime>(
    app: AppHandle<R>,
    url: String,
) -> Result<serde_json::Value, String> {
    let base = url.trim_end_matches('/');
    get_social(&format!("{base}/shouts"), session_token(&app).ok())
}

#[tauri::command]
pub fn marketplace_post_shout<R: Runtime>(
    app: AppHandle<R>,
    url: String,
    body: String,
) -> Result<(), String> {
    if body.trim().is_empty() {
        return Err("shout must not be blank".into());
    }
    if body.chars().count() > 240 {
        return Err("shout must be at most 240 characters".into());
    }
    let base = url.trim_end_matches('/');
    post_social(&app, &format!("{base}/shouts"), &serde_json::json!({ "body": body }))
}

/// Shared shape for the social GETs: attach the session when one exists,
/// go anonymous otherwise. Counts are public; "is it mine / am I following"
/// needs the token; a signed-out browse must still get the numbers.
fn get_social(url: &str, token: Option<String>) -> Result<serde_json::Value, String> {
    let (status, buf) = match token {
        Some(t) => get_capped_auth(url, FETCH_CAP, &t)?,
        None => get_capped_status(url, FETCH_CAP)?,
    };
    let text = String::from_utf8_lossy(&buf).into_owned();
    if !(200..300).contains(&status) {
        return Err(if text.trim().is_empty() { format!("HTTP {status}") } else { text });
    }
    serde_json::from_str(&text).map_err(|e| format!("not JSON: {e}"))
}

/// POST with the session token, surfacing the server's own error words —
/// social writes are user actions and must never fail silently.
fn post_social<R: Runtime>(
    app: &AppHandle<R>,
    url: &str,
    body: &serde_json::Value,
) -> Result<(), String> {
    let token = session_token(app)?;
    let (status, buf) = post_capped_json(url, body, AUTH_CAP, Some(&token))?;
    if !(200..300).contains(&status) {
        let text = String::from_utf8_lossy(&buf).into_owned();
        return Err(if text.trim().is_empty() { format!("HTTP {status}") } else { text });
    }
    Ok(())
}

fn is_safe_handle(h: &str) -> bool {
    !h.is_empty()
        && h.len() <= 24
        && h.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
}

/// Follower count + whether the caller follows this creator.
#[tauri::command]
pub fn marketplace_follow_status<R: Runtime>(
    app: AppHandle<R>,
    url: String,
    handle: String,
) -> Result<serde_json::Value, String> {
    if !is_safe_handle(&handle) {
        return Err("invalid handle".into());
    }
    let base = url.trim_end_matches('/');
    get_social(&format!("{base}/follows?handle={handle}"), session_token(&app).ok())
}

#[tauri::command]
pub fn marketplace_set_follow<R: Runtime>(
    app: AppHandle<R>,
    url: String,
    handle: String,
    following: bool,
) -> Result<(), String> {
    if !is_safe_handle(&handle) {
        return Err("invalid handle".into());
    }
    let base = url.trim_end_matches('/');
    post_social(&app, &format!("{base}/follows"), &serde_json::json!({ "handle": handle, "following": following }))
}

/// The creators the caller follows — the profile popout's Following tab.
#[tauri::command]
pub fn marketplace_follows_mine<R: Runtime>(app: AppHandle<R>, url: String) -> Result<serde_json::Value, String> {
    let token = session_token(&app)?;
    let base = url.trim_end_matches('/');
    get_social(&format!("{base}/follows/mine"), Some(token))
}

/// Public per-bundle favourite counts plus the caller's own list.
#[tauri::command]
pub fn marketplace_fetch_favourites<R: Runtime>(app: AppHandle<R>, url: String) -> Result<serde_json::Value, String> {
    let base = url.trim_end_matches('/');
    get_social(&format!("{base}/favourites"), session_token(&app).ok())
}

#[tauri::command]
pub fn marketplace_set_favourite<R: Runtime>(
    app: AppHandle<R>,
    url: String,
    id: String,
    favourite: bool,
) -> Result<(), String> {
    if !is_safe_id(&id) {
        return Err("invalid bundle id".into());
    }
    let base = url.trim_end_matches('/');
    post_social(&app, &format!("{base}/favourites"), &serde_json::json!({ "id": id, "favourite": favourite }))
}

/// Bundle ids from creators the caller follows, newest first. Ids only — the
/// client already holds the catalog and resolves them itself.
#[tauri::command]
pub fn marketplace_fetch_feed<R: Runtime>(app: AppHandle<R>, url: String) -> Result<serde_json::Value, String> {
    let token = session_token(&app)?;
    let base = url.trim_end_matches('/');
    get_social(&format!("{base}/feed"), Some(token))
}

/// Comments on one bundle. The session rides along when present so the
/// server can apply the caller's blocks — enforced there, not here, so a
/// modified client cannot un-block anyone.
#[tauri::command]
pub fn marketplace_fetch_comments<R: Runtime>(
    app: AppHandle<R>,
    url: String,
    id: String,
) -> Result<serde_json::Value, String> {
    if !is_safe_id(&id) {
        return Err("invalid bundle id".into());
    }
    let base = url.trim_end_matches('/');
    get_social(&format!("{base}/comments?id={id}"), session_token(&app).ok())
}

#[tauri::command]
pub fn marketplace_post_comment<R: Runtime>(
    app: AppHandle<R>,
    url: String,
    id: String,
    body: String,
) -> Result<(), String> {
    if !is_safe_id(&id) {
        return Err("invalid bundle id".into());
    }
    if body.trim().is_empty() {
        return Err("comment must not be blank".into());
    }
    if body.chars().count() > 1000 {
        return Err("comment must be at most 1000 characters".into());
    }
    let base = url.trim_end_matches('/');
    post_social(&app, &format!("{base}/comments"), &serde_json::json!({ "id": id, "body": body }))
}

#[tauri::command]
pub fn marketplace_set_block<R: Runtime>(
    app: AppHandle<R>,
    url: String,
    handle: String,
    blocking: bool,
) -> Result<(), String> {
    if !is_safe_handle(&handle) {
        return Err("invalid handle".into());
    }
    let base = url.trim_end_matches('/');
    post_social(&app, &format!("{base}/blocks"), &serde_json::json!({ "handle": handle, "blocking": blocking }))
}

#[tauri::command]
pub fn marketplace_report<R: Runtime>(
    app: AppHandle<R>,
    url: String,
    target_kind: String,
    target_id: String,
    reason: String,
) -> Result<(), String> {
    if !matches!(target_kind.as_str(), "comment" | "review" | "bundle" | "creator") {
        return Err("targetKind must be comment, review, bundle or creator".into());
    }
    let base = url.trim_end_matches('/');
    post_social(
        &app,
        &format!("{base}/reports"),
        &serde_json::json!({ "targetKind": target_kind, "targetId": target_id, "reason": reason }),
    )
}

/// Publish a layout. `manifest` and `layout` are both JSON strings, matching
/// the wire shape `POST /submissions` already uses for every other kind.
///
/// The caller has already stripped tile config (state/layoutPublish.ts) and
/// the server validates that again — a tile object carrying anything beyond
/// `type` and `rect` is refused, not quietly cleaned, since anyone can POST
/// to that endpoint without going through this command.
#[tauri::command]
pub fn marketplace_publish_layout<R: Runtime>(
    app: AppHandle<R>,
    url: String,
    manifest: String,
    layout: String,
    // Base64 PNG wireframe. Optional: a layout with no preview publishes
    // fine and falls back to the letter block, exactly like any other
    // previewless bundle.
    preview: Option<String>,
) -> Result<(), String> {
    let token = session_token(&app)?;
    let base = url.trim_end_matches('/');
    let mut body = serde_json::json!({ "kind": "layout", "manifest": manifest, "code": layout });
    if let Some(p) = preview.filter(|p| !p.is_empty()) {
        body["preview"] = serde_json::Value::String(p);
    }
    let (status, buf) = post_capped_json(&format!("{base}/submissions"), &body, AUTH_CAP, Some(&token))?;
    if !(200..300).contains(&status) {
        let text = String::from_utf8_lossy(&buf).into_owned();
        return Err(if text.trim().is_empty() { format!("publish failed: HTTP {status}") } else { text });
    }
    Ok(())
}

/// A creator's public profile plus what they have published. Unsigned browse
/// data, same silent-failure contract as ratings: callers treat any `Err` as
/// "no profile", never as an error worth interrupting browsing over.
#[tauri::command]
pub async fn marketplace_fetch_creator(url: String, handle: String) -> Result<serde_json::Value, String> {
    // Same shape as is_safe_id, but handles allow underscores too.
    if handle.is_empty()
        || handle.len() > 24
        || !handle.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
    {
        return Err("invalid handle".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let base = url.trim_end_matches('/');
        let bytes = get_capped(&format!("{base}/creators/{handle}"), FETCH_CAP)?;
        let body = String::from_utf8(bytes).map_err(|_| "creator not UTF-8".to_string())?;
        serde_json::from_str(&body).map_err(|e| format!("creator not JSON: {e}"))
    })
    .await
    .map_err(|e| format!("fetch task failed: {e}"))?
}

/// The signed-in account's own profile. Requires a session; the token is read
/// Rust-side and never crosses the IPC boundary as a parameter.
#[tauri::command]
pub fn marketplace_account_get<R: Runtime>(app: AppHandle<R>, url: String) -> Result<serde_json::Value, String> {
    let token = session_token(&app)?;
    let base = url.trim_end_matches('/');
    let (status, buf) = get_capped_auth(&format!("{base}/account"), FETCH_CAP, &token)?;
    let text = String::from_utf8_lossy(&buf).into_owned();
    if !(200..300).contains(&status) {
        return Err(if text.trim().is_empty() { format!("HTTP {status}") } else { text });
    }
    serde_json::from_str(&text).map_err(|e| format!("account not JSON: {e}"))
}

/// Claim a handle. One-time — the server refuses a second claim.
#[tauri::command]
pub fn marketplace_claim_handle<R: Runtime>(
    app: AppHandle<R>,
    url: String,
    handle: String,
) -> Result<(), String> {
    let token = session_token(&app)?;
    let base = url.trim_end_matches('/');
    let body = serde_json::json!({ "handle": handle });
    let (status, buf) = post_capped_json(&format!("{base}/account/handle"), &body, AUTH_CAP, Some(&token))?;
    if !(200..300).contains(&status) {
        let text = String::from_utf8_lossy(&buf).into_owned();
        return Err(if text.trim().is_empty() { format!("HTTP {status}") } else { text });
    }
    Ok(())
}

/// Edit display name, bio and links. Every field optional; the server
/// validates each one and returns a readable reason.
#[tauri::command]
pub fn marketplace_account_patch<R: Runtime>(
    app: AppHandle<R>,
    url: String,
    patch: serde_json::Value,
) -> Result<(), String> {
    let token = session_token(&app)?;
    let base = url.trim_end_matches('/');
    let (status, buf) = patch_capped_json(&format!("{base}/account"), &patch, AUTH_CAP, &token)?;
    if !(200..300).contains(&status) {
        let text = String::from_utf8_lossy(&buf).into_owned();
        return Err(if text.trim().is_empty() { format!("HTTP {status}") } else { text });
    }
    Ok(())
}

/// Casts (or replaces — the server's `(bundle_id, user_id)` primary key means
/// a second vote from this account REPLACES rather than stacks, see
/// server/src/ratings.rs) a 1-5 star vote for `id`.
///
/// The session token is read Rust-side via `secrets::secret_get_inner` and
/// attached as the `Authorization: Bearer` header inside `post_capped_json`
/// — it is never accepted as a parameter of this command (the frontend
/// cannot supply it even if it wanted to; `id`/`stars`/`url` are the only
/// inputs) and never appears in this function's `Ok` or `Err` return. An
/// absent or unparseable stored session — meaning: no token was ever read
/// off the wire, not even in transit — fails with "not signed in" before any
/// network request is made, the same fail-fast shape `marketplace_install`
/// uses for `is_safe_id`.
#[tauri::command]
pub fn marketplace_rate<R: Runtime>(
    app: AppHandle<R>,
    url: String,
    id: String,
    stars: i64,
) -> Result<(), String> {
    if !is_safe_id(&id) {
        return Err("invalid bundle id".into());
    }
    if !stars_in_range(stars) {
        return Err("stars must be an integer from 1 to 5".into());
    }
    let raw = crate::secrets::secret_get_inner(&app, SESSION_SECRET_KEY)
        .ok_or_else(|| "not signed in".to_string())?;
    let token = serde_json::from_str::<serde_json::Value>(&raw)
        .ok()
        .and_then(|v| v.get("token").and_then(|t| t.as_str()).map(str::to_string))
        .ok_or_else(|| "not signed in".to_string())?;

    let base = url.trim_end_matches('/');
    let endpoint = format!("{base}/ratings");
    let body = serde_json::json!({ "id": id, "stars": stars });
    let (status, buf) = post_capped_json(&endpoint, &body, AUTH_CAP, Some(&token))?;
    let text = String::from_utf8_lossy(&buf).into_owned();
    if let Some(msg) = rate_status_message(status, &text) {
        return Err(msg);
    }
    Ok(())
}

/// Fetches the curated collections — `[{"slug","title","blurb","items":[…]}]`.
/// Unsigned and public, exactly like `marketplace_fetch_ratings`: browse
/// garnish, not something a bundle's identity depends on, so it carries no
/// pubkey and callers treat any `Err` as "no collection shelves" rather than
/// an error worth surfacing.
///
/// Async + `spawn_blocking` — see `marketplace_fetch_ratings`'s doc comment.
#[tauri::command]
pub async fn marketplace_fetch_collections(url: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let base = url.trim_end_matches('/');
        let body_bytes = get_capped(&format!("{base}/collections"), FETCH_CAP)?;
        let body = String::from_utf8(body_bytes).map_err(|_| "collections not UTF-8".to_string())?;
        serde_json::from_str(&body).map_err(|e| format!("collections not JSON: {e}"))
    })
    .await
    .map_err(|e| format!("fetch task failed: {e}"))?
}

/// Async + `spawn_blocking` — see `marketplace_fetch_ratings`'s doc comment.
#[tauri::command]
pub async fn marketplace_fetch_index(url: String, pubkey: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let base = url.trim_end_matches('/');
        let body_bytes = get_capped(&format!("{base}/index.json"), FETCH_CAP)?;
        let body = String::from_utf8(body_bytes).map_err(|_| "index not UTF-8".to_string())?;
        verify_body(&body, &pubkey)
    })
    .await
    .map_err(|e| format!("fetch task failed: {e}"))?
}

/// Same fetch and verification as `marketplace_fetch_index`, but also returns
/// the RAW BODY so the frontend can cache it verbatim. Caching the parsed
/// value would be useless: `index.rs` signs the exact serialized `bundles`
/// substring, so a re-serialized copy could not be verified again.
#[tauri::command]
pub async fn marketplace_fetch_index_body(
    url: String,
    pubkey: String,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let base = url.trim_end_matches('/');
        let body_bytes = get_capped(&format!("{base}/index.json"), FETCH_CAP)?;
        let body = String::from_utf8(body_bytes).map_err(|_| "index not UTF-8".to_string())?;
        let value = verify_body(&body, &pubkey)?;
        Ok(serde_json::json!({ "body": body, "value": value }))
    })
    .await
    .map_err(|e| format!("fetch task failed: {e}"))?
}

/// Re-verifies a body the frontend cached earlier. A cached index is not
/// trusted just because it came from our own localStorage: the signature is
/// what makes it trustworthy, and localStorage is writable by anything
/// running in the webview.
#[tauri::command]
pub async fn marketplace_verify_index_body(
    body: String,
    pubkey: String,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || verify_body(&body, &pubkey))
        .await
        .map_err(|e| format!("verify task failed: {e}"))?
}

/// The verification half of `marketplace_fetch_index`, factored out so the
/// live fetch and the cache read cannot drift into two different checks.
fn verify_body(body: &str, pubkey: &str) -> Result<serde_json::Value, String> {
    let v: serde_json::Value =
        serde_json::from_str(body).map_err(|e| format!("index not JSON: {e}"))?;
    let sig = v.get("sig").and_then(|s| s.as_str()).ok_or("index missing sig")?;
    let bundles_str = extract_bundles_str(body).ok_or("index malformed")?;
    if !verify_index(bundles_str, sig, pubkey) {
        return Err("index signature does not verify — wrong key or tampered index".into());
    }
    Ok(v)
}

fn content_dir<R: Runtime>(
    app: &AppHandle<R>,
    sub: impl AsRef<std::path::Path>,
) -> Result<std::path::PathBuf, String> {
    let sub = sub.as_ref();
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?
        .join(sub);
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", sub.display()))?;
    Ok(dir)
}

fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// Provenance marker read by `visualizers::folder_entry` (via `folder_source`)
/// to distinguish deliberately-installed content from a hand-authored draft.
/// Written on every successful install so it survives a restart; deleted
/// along with the rest of the folder on uninstall.
///
/// `origin` ("seed" or "marketplace") comes from the caller, never from the
/// zip — see `install_bundle_zip`.
fn write_installed_marker(
    dir: &std::path::Path,
    id: &str,
    version: &str,
    kind: &str,
    origin: &str,
) -> Result<(), String> {
    let installed_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let marker = serde_json::json!({
        "id": id,
        "version": version,
        "kind": kind,
        "installed_at": installed_at,
        "origin": origin,
    });
    std::fs::write(dir.join("installed.json"), marker.to_string())
        .map_err(|e| format!("write installed.json: {e}"))
}

/// Whether `kind`/`id` is already installed: its install directory exists and
/// contains the `installed.json` marker written by `write_installed_marker`.
/// Used by the seed installer (Task 5) to skip a bundle already on disk.
///
/// Presets now get the same per-id folder + marker as visualizers/tiles (see
/// `install_bundle_zip`'s `"preset"` arm) — this doc comment previously
/// claimed presets had neither and always returned false for that kind; that
/// is no longer true. `seed_sync` still never walks preset seeds regardless
/// (see seed.rs), so this arm exists for completeness/future callers rather
/// than because seed_sync depends on it today.
pub fn is_installed<R: Runtime>(app: &AppHandle<R>, kind: &str, id: &str) -> bool {
    let sub_path = match kind {
        "visualizer" => std::path::PathBuf::from("visualizers"),
        "tile" => std::path::PathBuf::from("tiles"),
        "preset" => std::path::PathBuf::from("presets").join("marketplace"),
        _ => return false,
    };
    match content_dir(app, &sub_path) {
        Ok(dir) => dir.join(id).join("installed.json").is_file(),
        Err(_) => false,
    }
}

/// Reads a zip archive and returns its entries as `name -> raw bytes`.
///
/// Allowlist is exact entry names — no paths, no traversal. Deliberately
/// excludes `installed.json`: that marker is written by us on install, never
/// accepted from a downloaded (or seeded) bundle, so a malicious archive
/// can't self-certify marketplace provenance (see `folder_source` in
/// visualizers.rs / tiles.rs).
fn entries_of(zip: &[u8]) -> Result<std::collections::HashMap<String, Vec<u8>>, String> {
    let mut archive =
        zip::ZipArchive::new(std::io::Cursor::new(zip)).map_err(|e| format!("bad zip: {e}"))?;
    let mut entries: std::collections::HashMap<String, Vec<u8>> = std::collections::HashMap::new();
    for i in 0..archive.len() {
        let mut f = archive.by_index(i).map_err(|e| format!("zip entry: {e}"))?;
        let name = f.name().to_string();
        if !matches!(name.as_str(), "manifest.json" | "main.js" | "preset.json" | "view.json") {
            return Err(format!("unexpected file in bundle: {name}"));
        }
        let mut buf = Vec::new();
        f.read_to_end(&mut buf).map_err(|e| format!("read {name}: {e}"))?;
        // Pre-refactor this read as a String, which rejected non-UTF-8 content
        // and aborted the install with nothing written. Keep that same
        // atomic-reject behavior even though entries are now bytes: a bundle
        // that fails here writes no directory, no files, no marker, rather
        // than installing and failing forever at load time as "marketplace"
        // content the user must uninstall.
        std::str::from_utf8(&buf).map_err(|e| format!("read {name}: {e}"))?;
        entries.insert(name, buf);
    }
    Ok(entries)
}

/// Extracts a verified bundle zip into the install directory.
///
/// The ONLY path that writes bundle content to disk. Seeded and downloaded
/// bundles both come through here so neither can skip the zip-entry allowlist
/// or the required-file presence check (a manifest.json/view.json/main.js
/// entry must exist for the given kind) — a hand-copy into %APPDATA% is what
/// shipped uninstallable tiles at 1.0.0. This does NOT validate manifest
/// *content*; that happens later, at read time, via `validate_folder` in
/// visualizers.rs / tiles.rs.
///
/// `id` is validated here (not caller-trusted) because it is joined directly
/// onto the install directory below — an unchecked `id` would be a path-
/// traversal primitive.
///
/// `origin` is recorded in installed.json as "seed" or "marketplace".
pub fn install_bundle_zip<R: Runtime>(
    app: &AppHandle<R>,
    kind: &str,
    id: &str,
    version: &str,
    zip: &[u8],
    origin: &str,
) -> Result<(), String> {
    if !is_safe_id(id) {
        return Err("invalid bundle id".into());
    }
    let entries = entries_of(zip)?;

    match kind {
        "visualizer" => {
            let manifest = entries.get("manifest.json").ok_or("bundle missing manifest.json")?;
            let code = entries.get("main.js").ok_or("bundle missing main.js")?;
            let dir = content_dir(app, "visualizers")?.join(id);
            std::fs::create_dir_all(&dir).map_err(|e| format!("create {id}: {e}"))?;
            std::fs::write(dir.join("manifest.json"), manifest).map_err(|e| format!("write manifest: {e}"))?;
            std::fs::write(dir.join("main.js"), code).map_err(|e| format!("write main.js: {e}"))?;
            write_installed_marker(&dir, id, version, kind, origin)?;
        }
        "tile" => {
            let manifest = entries.get("manifest.json").ok_or("bundle missing manifest.json")?;
            let view = entries.get("view.json").ok_or("bundle missing view.json")?;
            let dir = content_dir(app, "tiles")?.join(id);
            std::fs::create_dir_all(&dir).map_err(|e| format!("create {id}: {e}"))?;
            std::fs::write(dir.join("manifest.json"), manifest).map_err(|e| format!("write manifest: {e}"))?;
            std::fs::write(dir.join("view.json"), view).map_err(|e| format!("write view.json: {e}"))?;
            write_installed_marker(&dir, id, version, kind, origin)?;
        }
        "preset" => {
            let manifest = entries.get("manifest.json").ok_or("bundle missing manifest.json")?;
            let preset = entries.get("preset.json").ok_or("bundle missing preset.json")?;
            let dir = content_dir(app, "presets")?.join("marketplace").join(id);
            std::fs::create_dir_all(&dir).map_err(|e| format!("create {id}: {e}"))?;
            std::fs::write(dir.join("manifest.json"), manifest).map_err(|e| format!("write manifest: {e}"))?;
            std::fs::write(dir.join("preset.json"), preset).map_err(|e| format!("write preset: {e}"))?;
            write_installed_marker(&dir, id, version, kind, origin)?;
            // Clean up the pre-0.6 flat-file layout for this id, if present — that
            // path was never exposed in the UI, but a leftover would show up as an
            // anonymous "user preset" in the picker.
            let legacy = content_dir(app, "presets")?.join(format!("{id}.json"));
            if legacy.is_file() { let _ = std::fs::remove_file(&legacy); }
        }
        other => return Err(format!("unknown kind {other}")),
    }
    Ok(())
}

/// Decides which bytes `marketplace_install` should proceed with: the
/// network's, or — only on network failure — the seed's. Pulled out as a
/// pure function (no `AppHandle`, no I/O) so this decision is unit-testable
/// without a live app or a network seam, the same shape `plan_seeds` (Task 5)
/// used to make the seed-install decision testable independent of the real
/// directory walk.
///
/// `seed_lookup` is only invoked in the `Err` arm — a `FnOnce` closure that
/// panics or sets a flag when called lets a test prove a successful fetch
/// never consults the seed at all, not just that it doesn't end up using it.
///
/// On fetch failure with no matching seed, the ORIGINAL network error is
/// returned verbatim (not a substituted "no seed" message) — the caller
/// needs the real failure reason (offline vs. server error vs. bad request),
/// and a seed simply not existing for this id@version is not itself
/// noteworthy.
///
/// Deliberately does NOT verify the returned bytes — sha256 verification
/// stays the caller's job, downstream of this function, so it can never be
/// bypassed no matter how many byte sources this function grows to choose
/// between.
fn resolve_zip_bytes(
    fetched: Result<Vec<u8>, String>,
    seed_lookup: impl FnOnce() -> Option<Vec<u8>>,
) -> Result<Vec<u8>, String> {
    match fetched {
        Ok(bytes) => Ok(bytes),
        Err(net_err) => match seed_lookup() {
            Some(bytes) => Ok(bytes),
            None => Err(net_err),
        },
    }
}

#[tauri::command]
pub fn marketplace_install<R: Runtime>(
    app: AppHandle<R>,
    url: String,
    id: String,
    version: String,
    sha256: String,
    kind: String,
) -> Result<(), String> {
    if !is_safe_id(&id) {
        return Err("invalid bundle id".into());
    }
    let base = url.trim_end_matches('/');
    // Offline reinstall: a network failure (no connection, server down, plane
    // wifi) falls back to the seed copy shipped in resources, if one exists
    // for this EXACT id@version — see `seed_zip_for`'s doc for why a stale
    // seed can never satisfy a different version. `resolve_zip_bytes` only
    // calls the seed closure when the fetch failed, so a successful fetch
    // always wins and is never silently replaced by stale seed content. The
    // bytes it returns — from either source — still go through the sha256
    // check below exactly like a download; verification is not relaxed for
    // seeds, so a corrupted or tampered seed zip fails the same way a
    // corrupted download would.
    let zip_bytes = resolve_zip_bytes(
        get_capped(&format!("{base}/bundle/{id}/{version}"), ZIP_CAP),
        || crate::seed::seed_zip_for(&app, &kind, &id, &version),
    )?;
    if zip_bytes.len() > ZIP_CAP {
        return Err("bundle too large".into());
    }
    let got = hex::encode(Sha256::digest(&zip_bytes));
    if got != sha256 {
        return Err("bundle hash does not match the signed index — refusing to install".into());
    }

    install_bundle_zip(&app, &kind, &id, &version, &zip_bytes, "marketplace")
}

#[tauri::command]
pub fn marketplace_uninstall<R: Runtime>(app: AppHandle<R>, id: String, kind: String) -> Result<(), String> {
    if !is_safe_id(&id) {
        return Err("invalid bundle id".into());
    }
    match kind.as_str() {
        "visualizer" => {
            let dir = content_dir(&app, "visualizers")?.join(&id);
            if dir.exists() {
                std::fs::remove_dir_all(&dir).map_err(|e| format!("remove {id}: {e}"))?;
            }
        }
        "tile" => {
            let dir = content_dir(&app, "tiles")?.join(&id);
            if dir.exists() {
                std::fs::remove_dir_all(&dir).map_err(|e| format!("remove {id}: {e}"))?;
            }
        }
        "preset" => {
            let dir = content_dir(&app, "presets")?.join("marketplace").join(&id);
            if dir.exists() {
                std::fs::remove_dir_all(&dir).map_err(|e| format!("remove {id}: {e}"))?;
            }
            let legacy = content_dir(&app, "presets")?.join(format!("{id}.json"));
            if legacy.is_file() { let _ = std::fs::remove_file(&legacy); }
        }
        other => return Err(format!("unknown kind {other}")),
    }
    Ok(())
}

/// Identifies an image by its magic number, never by a declared content
/// type — a hostile server controls the `Content-Type` header but not the
/// meaning of the bytes it sends, so trusting the header would let it label
/// arbitrary bytes (e.g. an SVG carrying script, or plain HTML) as an image
/// and have them decoded/rendered as one downstream.
pub fn sniff_image(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() >= 8 && bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Some("image/png");
    }
    if bytes.len() >= 3 && bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("image/jpeg");
    }
    None
}

/// Like `sniff_image` but for Market v2's `bundle_media` assets, which may
/// also be animated: GIF and WebP join PNG/JPEG. Kept SEPARATE from
/// `sniff_image` deliberately — widening that one would silently let an
/// animated asset through the legacy `/preview` path too, where every 0.7.x
/// client expects a still and would render a first frame at best.
pub fn sniff_media(bytes: &[u8]) -> Option<&'static str> {
    if let Some(mime) = sniff_image(bytes) {
        return Some(mime);
    }
    if bytes.len() >= 6 && (bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a")) {
        return Some("image/gif");
    }
    if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    None
}

/// Fetches a bundle's preview image and hands it to the frontend as an inert
/// `data:` URL.
///
/// The page's CSP has no `img-src` for the marketplace host, and
/// deliberately so: granting one would let ANY page-level image reference
/// (not just a vetted `<img>` this command controls) reach the network. This
/// command routes the fetch through the same `get_capped` client used for
/// the index and bundles instead, so the renderer never makes its own
/// request — the bytes cross into the page already decoded into a data URL,
/// never as a live URL the page could be tricked into re-requesting.
///
/// `id` and `kind` are validated before any URL is built, same as
/// `marketplace_install`. `version` is validated too, via `seed::
/// is_safe_version` — reused rather than a fourth id/version charset
/// variant in this file — because it is interpolated straight into the
/// request path below; an unvalidated version is exactly the kind of
/// "trusted" string that turns into a request-path or header-injection
/// primitive the moment a hostile index entry supplies it.
/// Async + `spawn_blocking` — see `marketplace_fetch_ratings`'s doc comment.
/// This is the command where sync-on-main-thread actually took the app down:
/// the Content Library mounts one of these per catalog row, so a catalog with
/// hundreds of presets queued hundreds of blocking 10s-timeout HTTP fetches
/// on the main thread and the window stopped responding (2026-08-02 report
/// from the first outside user).
#[tauri::command]
pub async fn marketplace_fetch_preview(url: String, id: String, version: String, kind: String) -> Result<String, String> {
    if !is_safe_id(&id) {
        return Err("invalid bundle id".into());
    }
    if kind != "tile" && kind != "visualizer" && kind != "preset" {
        return Err("invalid kind".into());
    }
    if !crate::seed::is_safe_version(&version) {
        return Err("invalid bundle version".into());
    }
    let base = url.trim_end_matches('/').to_string();
    if !base.starts_with("https://") {
        return Err("marketplace url must be https".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let endpoint = format!("{base}/bundle/{id}/{version}/preview");
        let bytes = get_capped(&endpoint, PREVIEW_CAP)?;
        let mime = sniff_image(&bytes).ok_or("preview is not a PNG or JPEG")?;
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        Ok(format!("data:{mime};base64,{}", STANDARD.encode(&bytes)))
    })
    .await
    .map_err(|e| format!("fetch task failed: {e}"))?
}

/// Fetches one `bundle_media` asset by index, as an inert `data:` URL —
/// exactly the same shape and the same silent-failure contract as
/// `marketplace_fetch_preview`, which callers treat as "no image".
///
/// Index 0 is deliberately NOT routed here by the client (see
/// PreviewImage.tsx): the server aliases `/preview` to media 0 and falls back
/// to the legacy blob there, so index 0 must keep taking the preview route or
/// every pre-Market-v2 bundle loses its image.
#[tauri::command]
pub async fn marketplace_fetch_media(
    url: String,
    id: String,
    version: String,
    idx: u32,
) -> Result<String, String> {
    if !is_safe_id(&id) {
        return Err("invalid bundle id".into());
    }
    if !crate::seed::is_safe_version(&version) {
        return Err("invalid bundle version".into());
    }
    if idx > 5 {
        return Err("invalid media index".into());
    }
    let base = url.trim_end_matches('/').to_string();
    if !base.starts_with("https://") {
        return Err("marketplace url must be https".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let endpoint = format!("{base}/bundle/{id}/{version}/media/{idx}");
        let bytes = get_capped(&endpoint, MEDIA_CAP)?;
        let mime = sniff_media(&bytes).ok_or("media is not a PNG, JPEG, GIF or WebP")?;
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        Ok(format!("data:{mime};base64,{}", STANDARD.encode(&bytes)))
    })
    .await
    .map_err(|e| format!("fetch task failed: {e}"))?
}

#[derive(Serialize)]
pub struct BrokerResponse {
    pub status: u16,
    pub body: String,
}

const MAX_HEADERS: usize = 16;
const MAX_HEADER_VALUE_BYTES: usize = 4096;

fn is_valid_header_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// Non-empty, size-capped, and free of CR/LF/NUL/other ASCII control bytes
/// (`is_ascii_control` covers 0x00-0x1F and 0x7F, i.e. exactly the CRLF-
/// injection-capable range plus NUL).
fn is_valid_header_value(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_HEADER_VALUE_BYTES
        && !value.bytes().any(|b| b.is_ascii_control())
}

/// Validates a bundle-declared header map before it reaches the outgoing
/// request. These names/values are built host-side from substituted config
/// and secret values (see `tiles/request.ts`'s `buildRequest`), so unlike the
/// url check above they are NOT trusted input — a manifest author (or a
/// compromised/malicious upstream API response feeding back into a config
/// value) could otherwise smuggle a CRLF sequence into a header and inject a
/// second header or split the request. Reject rather than sanitise: a value
/// that needed stripping is a bug the tile author should see, not something
/// silently fixed up for them.
fn validate_headers(headers: &std::collections::HashMap<String, String>) -> Result<(), String> {
    if headers.len() > MAX_HEADERS {
        return Err(format!("too many headers (max {MAX_HEADERS})"));
    }
    for (name, value) in headers {
        if !is_valid_header_name(name) {
            return Err(format!(
                "invalid header name {name:?} (must be 1-64 chars of [A-Za-z0-9-])"
            ));
        }
        // Case-insensitive: a bundle setting either of these could retarget
        // the request (Host) or desync the body length (Content-Length).
        let lower = name.to_ascii_lowercase();
        if lower == "host" || lower == "content-length" {
            return Err(format!("header {name:?} may not be set by a tile"));
        }
        if !is_valid_header_value(value) {
            return Err(format!(
                "invalid value for header {name:?} (must be non-empty, <= {MAX_HEADER_VALUE_BYTES} bytes, no control characters)"
            ));
        }
    }
    Ok(())
}

/// True for any 3xx status. Pulled out as a pure function so the "reject a
/// redirect" rule is unit-testable without a network round-trip.
fn is_redirect_status(status: u16) -> bool {
    (300..400).contains(&status)
}

/// The fetch the sandbox broker performs for installed tiles. Host allowlisting
/// is enforced in the frontend broker (broker.ts) before this is called; this
/// enforces https + size caps as defense in depth. `headers` lets a tile's
/// declared request (e.g. `Authorization: Bearer <secret>`) actually reach the
/// server — see `validate_headers` for why they're strictly validated rather
/// than passed through as-is.
///
/// Redirects are never followed (`redirects(0)`). `brokerDecide` (broker.ts)
/// only checks the INITIAL url's host before this command is ever invoked; a
/// default ureq agent follows up to 5 redirects and isn't `https_only`, so an
/// allowlisted host could 302 to `http://127.0.0.1:…` or a LAN address and the
/// response would flow straight into the tile's scope — SSRF straight through
/// the permission check, with non-Authorization secret headers still attached
/// across the hop (I2). With `redirects(0)` a 3xx is just an ordinary
/// response ureq hands back without following; it's turned into a clear error
/// below instead of silently chasing the Location header.
#[tauri::command]
pub fn broker_fetch(
    url: String,
    headers: Option<std::collections::HashMap<String, String>>,
) -> Result<BrokerResponse, String> {
    if !url.starts_with("https://") {
        return Err("only https URLs are allowed".into());
    }
    if let Some(h) = &headers {
        validate_headers(h)?;
    }
    let agent = ureq::AgentBuilder::new().redirects(0).build();
    let mut req = agent.get(&url).timeout(std::time::Duration::from_secs(10));
    if let Some(h) = &headers {
        for (name, value) in h {
            req = req.set(name, value);
        }
    }
    let resp = req.call().map_err(|e| format!("request failed: {e}"))?;
    let status = resp.status();
    if is_redirect_status(status) {
        return Err(format!(
            "server responded with a redirect (HTTP {status}) — redirects are not followed"
        ));
    }
    let mut buf = Vec::new();
    resp.into_reader()
        .take((FETCH_CAP + 1) as u64)
        .read_to_end(&mut buf)
        .map_err(|e| format!("read failed: {e}"))?;
    if buf.len() > FETCH_CAP {
        return Err("response too large".into());
    }
    Ok(BrokerResponse {
        status,
        body: String::from_utf8_lossy(&buf).into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    #[test]
    fn index_signature_round_trips() {
        let seed = [3u8; 32];
        let sk = SigningKey::from_bytes(&seed);
        let pubkey = hex::encode(sk.verifying_key().to_bytes());
        let bundles = r#"[{"id":"cool","version":"1.0.0"}]"#;
        let sig = hex::encode(sk.sign(bundles.as_bytes()).to_bytes());
        assert!(verify_index(bundles, &sig, &pubkey));
        // Tamper → fails.
        assert!(!verify_index(&bundles.replace("cool", "evil"), &sig, &pubkey));
        // Wrong key → fails.
        let other = hex::encode(SigningKey::from_bytes(&[9u8; 32]).verifying_key().to_bytes());
        assert!(!verify_index(bundles, &sig, &other));
    }

    #[test]
    fn extracts_bundles_substring() {
        let raw = r#"{"generated_at":1,"bundles":[{"id":"x"}],"pubkey":"aa","sig":"bb"}"#;
        assert_eq!(extract_bundles_str(raw), Some(r#"[{"id":"x"}]"#));
    }

    #[test]
    fn safe_id_blocks_traversal() {
        assert!(is_safe_id("cool-preset"));
        assert!(!is_safe_id("../etc"));
        assert!(!is_safe_id("Up"));
        assert!(!is_safe_id(""));
    }

    #[test]
    fn resolve_zip_bytes_prefers_the_network_and_never_consults_the_seed() {
        // A successful fetch must win outright — not just "the seed isn't
        // used", but the seed closure is never even called, so a server
        // update can never be silently replaced by stale seed content.
        let got = resolve_zip_bytes(Ok(vec![1, 2, 3]), || {
            panic!("seed_lookup must not be called when the fetch succeeded")
        });
        assert_eq!(got, Ok(vec![1, 2, 3]));
    }

    #[test]
    fn resolve_zip_bytes_falls_back_to_the_seed_on_fetch_failure() {
        let got = resolve_zip_bytes(Err("connection refused".into()), || Some(vec![9, 9, 9]));
        assert_eq!(got, Ok(vec![9, 9, 9]));
    }

    #[test]
    fn resolve_zip_bytes_propagates_the_original_network_error_when_no_seed_exists() {
        // Not a substituted "no seed" message — the caller needs the real
        // failure reason (offline vs. server error vs. bad request).
        let got = resolve_zip_bytes(Err("connection refused".into()), || None);
        assert_eq!(got, Err("connection refused".to_string()));
    }

    #[test]
    fn resolve_zip_bytes_hands_seed_bytes_onward_unmodified() {
        // The bytes chosen here are exactly what the caller's sha256 check
        // sees — resolve_zip_bytes must not touch, hash, or otherwise
        // transform them; verification stays the caller's job.
        let seed_bytes = vec![0xDE, 0xAD, 0xBE, 0xEF];
        let got = resolve_zip_bytes(Err("timed out".into()), || Some(seed_bytes.clone()));
        assert_eq!(got, Ok(seed_bytes));
    }

    #[test]
    fn install_rejects_unexpected_zip_entry() {
        // Build a zip containing an entry that is not in the allowlist.
        let mut buf = Vec::new();
        {
            let mut w = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let opts = zip::write::SimpleFileOptions::default();
            w.start_file("manifest.json", opts).unwrap();
            use std::io::Write;
            w.write_all(br#"{"id":"x","name":"X","version":"1.0.0","api":1,"permissions":[]}"#).unwrap();
            w.start_file("installed.json", opts).unwrap();
            w.write_all(b"{}").unwrap();
            w.finish().unwrap();
        }
        let err = entries_of(&buf).unwrap_err();
        assert!(err.contains("unexpected file"), "got: {err}");
    }

    #[test]
    fn entries_of_matches_entry_names_exactly_not_by_suffix_or_basename() {
        // The allowlist is exact-string matching against the full entry
        // name — not a suffix or basename match. These are exactly the
        // shapes a `ends_with("view.json")` or "last path segment" check
        // would wrongly accept, and traversal/nesting depends on staying
        // exact here.
        fn file_zip(name: &str) -> Vec<u8> {
            let mut buf = Vec::new();
            let mut w = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let opts = zip::write::SimpleFileOptions::default();
            w.start_file(name, opts).unwrap();
            use std::io::Write;
            w.write_all(b"{}").unwrap();
            w.finish().unwrap();
            buf
        }
        for name in ["../view.json", "./view.json", "sub/view.json"] {
            let err = entries_of(&file_zip(name)).unwrap_err();
            assert!(err.contains("unexpected file"), "{name}: got {err}");
        }

        // A directory entry (zip's add_directory stores it as "view.json/")
        // must not be mistaken for the file "view.json".
        let mut buf = Vec::new();
        let mut w = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
        let opts = zip::write::SimpleFileOptions::default();
        w.add_directory("view.json", opts).unwrap();
        w.finish().unwrap();
        let err = entries_of(&buf).unwrap_err();
        assert!(err.contains("unexpected file"), "directory entry: got {err}");
    }

    fn headers(pairs: &[(&str, &str)]) -> std::collections::HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn validate_headers_accepts_a_valid_set() {
        let h = headers(&[("Authorization", "Bearer sk-1"), ("X-Plain", "v1")]);
        assert!(validate_headers(&h).is_ok());
    }

    #[test]
    fn validate_headers_rejects_crlf_in_a_value() {
        let h = headers(&[("Authorization", "Bearer sk-1\r\nX-Injected: evil")]);
        let err = validate_headers(&h).unwrap_err();
        assert!(err.contains("Authorization"), "{err}");
    }

    #[test]
    fn validate_headers_rejects_a_bad_name() {
        let h = headers(&[("X Bad Name", "v1")]);
        let err = validate_headers(&h).unwrap_err();
        assert!(err.contains("invalid header name"), "{err}");
    }

    #[test]
    fn validate_headers_rejects_host() {
        let h = headers(&[("Host", "evil.example.com")]);
        let err = validate_headers(&h).unwrap_err();
        assert!(err.contains("Host"), "{err}");
        // Case-insensitive.
        let h2 = headers(&[("host", "evil.example.com")]);
        assert!(validate_headers(&h2).is_err());
    }

    #[test]
    fn validate_headers_rejects_content_length() {
        let h = headers(&[("Content-Length", "0")]);
        assert!(validate_headers(&h).is_err());
    }

    #[test]
    fn redirect_status_range_matches_ureq_convention_3xx() {
        // ureq treats 300..399 as "a redirect it could have followed"; with
        // redirects(0) it hands the un-followed response back as Ok rather
        // than erroring, so broker_fetch must catch this range itself (I2).
        assert!(!is_redirect_status(299));
        assert!(is_redirect_status(300));
        assert!(is_redirect_status(301));
        assert!(is_redirect_status(302));
        assert!(is_redirect_status(399));
        assert!(!is_redirect_status(400));
        assert!(!is_redirect_status(200));
    }

    #[test]
    fn sniff_image_accepts_png_and_jpeg_by_magic_number() {
        assert_eq!(sniff_image(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0]), Some("image/png"));
        assert_eq!(sniff_image(&[0xFF, 0xD8, 0xFF, 0xE0, 0, 0]), Some("image/jpeg"));
    }

    #[test]
    fn sniff_image_rejects_non_images_and_short_input() {
        assert_eq!(sniff_image(b"<html><body>nope"), None);
        assert_eq!(sniff_image(&[0x89, b'P']), None);
        assert_eq!(sniff_image(&[]), None);
    }

    #[test]
    fn sniff_media_accepts_animation_formats_the_still_sniffer_rejects() {
        // GIF and WebP are media-only: widening sniff_image would let an
        // animated asset through the legacy /preview path, where a 0.7.x
        // client expects a still.
        assert_eq!(sniff_media(b"GIF89a\0\0\0\0"), Some("image/gif"));
        assert_eq!(sniff_media(b"RIFF\0\0\0\0WEBPVP8 "), Some("image/webp"));
        assert_eq!(sniff_image(b"GIF89a\0\0\0\0"), None);
        assert_eq!(sniff_image(b"RIFF\0\0\0\0WEBPVP8 "), None);
    }

    #[test]
    fn sniff_media_still_accepts_stills_and_rejects_junk() {
        assert_eq!(sniff_media(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0]), Some("image/png"));
        assert_eq!(sniff_media(b"RIFF\0\0\0\0AVI LIST"), None, "a RIFF container that is not WebP");
        assert_eq!(sniff_media(b"<html>"), None);
        assert_eq!(sniff_media(&[]), None);
    }

    #[test]
    fn media_cap_sits_between_the_preview_and_bundle_caps() {
        // An animation may be larger than a thumbnail and must still never
        // reach what a whole bundle may consume.
        assert!(PREVIEW_CAP < MEDIA_CAP);
        assert!(MEDIA_CAP < ZIP_CAP);
    }

    #[test]
    fn preview_cap_is_smaller_than_the_bundle_cap() {
        // A preview is a thumbnail; it must not be able to consume the 4 MiB a
        // bundle may. Pinning the relationship stops a later edit widening it.
        assert!(PREVIEW_CAP < ZIP_CAP);
        assert_eq!(PREVIEW_CAP, 262_144);
    }

    #[test]
    fn caps_are_ordered_and_pinned_to_their_exact_values() {
        // get_capped takes its cap from the caller, not a hardcoded internal
        // constant — see its doc comment for the bug that shipped when it
        // didn't. Nothing else in this file stops a future edit from
        // re-hardcoding a cap inside get_capped, or swapping which constant
        // a call site passes (e.g. marketplace_install passing FETCH_CAP
        // again, silently re-introducing the 1 MiB bundle ceiling this same
        // change fixed). Pinning the exact values, and their strict order,
        // makes either regression a failing test instead of a silent revert.
        assert!(FETCH_CAP < ZIP_CAP);
        assert_eq!(FETCH_CAP, 1_048_576);
        assert_eq!(ZIP_CAP, 4_194_304);
    }

    #[test]
    fn validate_headers_enforces_the_16_header_cap() {
        let pairs: Vec<(String, String)> = (0..17)
            .map(|i| (format!("X-Header-{i}"), "v".to_string()))
            .collect();
        let h: std::collections::HashMap<String, String> =
            pairs.into_iter().collect();
        let err = validate_headers(&h).unwrap_err();
        assert!(err.contains("too many headers"), "{err}");
    }

    #[test]
    fn validate_headers_rejects_empty_and_oversized_values() {
        let empty = headers(&[("X-Empty", "")]);
        assert!(validate_headers(&empty).is_err());
        let oversized = headers(&[("X-Big", &"a".repeat(MAX_HEADER_VALUE_BYTES + 1))]);
        assert!(validate_headers(&oversized).is_err());
    }

    #[test]
    fn mask_email_matches_the_servers_author_masking_format() {
        // Mirrors server/src/index.rs's `format!("{}***", email.chars().take(3)...)`
        // exactly — the app must never invent its own masking convention that
        // could disagree with what a user has already seen the server print.
        assert_eq!(mask_email("oliver@example.com"), "oli***");
        // Whatever the first 3 characters are, verbatim — the server's
        // masking is not "local part before @", it's a flat first-3-chars-
        // of-the-whole-string rule, "@" included if it lands in that window.
        assert_eq!(mask_email("ab@x.io"), "ab@***");
        assert_eq!(mask_email("a"), "a***"); // shorter than 3 chars: takes what's there
        assert_eq!(mask_email(""), "***");
    }

    #[test]
    fn login_status_message_distinguishes_wrong_password_from_unverified_and_rate_limited() {
        // The whole point of this task: a 401, a 403 and a 429 must not
        // collapse into one generic "sign-in failed" — the user needs to know
        // which of these it was.
        assert!(login_status_message(200).is_none());
        let unauthorized = login_status_message(401).unwrap();
        let unverified = login_status_message(403).unwrap();
        let rate_limited = login_status_message(429).unwrap();
        assert_ne!(unauthorized, unverified);
        assert_ne!(unauthorized, rate_limited);
        assert_ne!(unverified, rate_limited);
        assert!(unauthorized.contains("password"), "{unauthorized}");
        assert!(unverified.contains("verif"), "{unverified}");
        assert!(rate_limited.contains("many"), "{rate_limited}");
    }

    #[test]
    fn login_status_message_falls_back_to_the_raw_status_for_anything_unrecognised() {
        let msg = login_status_message(500).unwrap();
        assert!(msg.contains("500"), "{msg}");
    }

    #[test]
    fn post_capped_json_rejects_non_https_without_making_a_request() {
        // No network involved in this branch — the https check runs before
        // any request is issued, so this is safe to run in any test
        // environment, sandboxed or not.
        let err = post_capped_json("http://example.com/auth/login", &serde_json::json!({}), AUTH_CAP, None)
            .unwrap_err();
        assert!(err.contains("https"), "{err}");
    }

    #[test]
    fn session_blob_has_token_requires_a_real_non_empty_token_field() {
        assert!(session_blob_has_token(r#"{"token":"abc123","email_masked":"oli***"}"#));
        assert!(!session_blob_has_token(r#"{"token":"","email_masked":"oli***"}"#), "empty string token");
        assert!(!session_blob_has_token(r#"{"email_masked":"oli***"}"#), "no token field at all");
        assert!(!session_blob_has_token(r#"{"token":123}"#), "token is the wrong JSON type");
        assert!(!session_blob_has_token("not json"), "unparseable blob");
        assert!(!session_blob_has_token(""), "empty blob");
    }

    #[test]
    fn stars_in_range_accepts_1_to_5_only() {
        for ok in 1i64..=5 {
            assert!(stars_in_range(ok), "{ok} should be in range");
        }
        assert!(!stars_in_range(0));
        assert!(!stars_in_range(6));
        assert!(!stars_in_range(-1));
        assert!(!stars_in_range(i64::MAX));
    }

    #[test]
    fn rate_status_message_forwards_the_servers_own_body_text() {
        // server/src/ratings.rs's actual failure bodies — this must forward
        // them verbatim, not invent a second copy of the same messages.
        assert_eq!(
            rate_status_message(400, "stars must be an integer from 1 to 5"),
            Some("stars must be an integer from 1 to 5".to_string())
        );
        assert_eq!(
            rate_status_message(400, "bundle does not exist or is not approved"),
            Some("bundle does not exist or is not approved".to_string())
        );
        assert_eq!(rate_status_message(401, "auth required"), Some("auth required".to_string()));
    }

    #[test]
    fn rate_status_message_is_none_only_for_200() {
        assert_eq!(rate_status_message(200, "{\"ok\":true}"), None);
        assert!(rate_status_message(201, "").is_some(), "200 specifically, not just any 2xx");
    }

    #[test]
    fn rate_status_message_falls_back_to_the_status_when_the_body_is_empty() {
        let msg = rate_status_message(500, "").unwrap();
        assert!(msg.contains("500"), "{msg}");
    }

    #[test]
    fn session_status_type_carries_no_token_field() {
        // Regression guard: MarketplaceSessionStatus must never grow a token
        // field. Serializing it and checking the key set catches a future
        // edit that adds one just as reliably as a doc comment, and doesn't
        // rely on anyone re-reading the doc comment before doing it.
        let status = MarketplaceSessionStatus { signed_in: true, email: Some("oli***".into()) };
        let v = serde_json::to_value(&status).unwrap();
        let mut keys: Vec<&str> = v.as_object().unwrap().keys().map(String::as_str).collect();
        keys.sort();
        assert_eq!(keys, vec!["email", "signedIn"]);
    }
}
