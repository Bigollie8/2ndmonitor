//! Discord integration via OAuth2 PKCE → REST API polling.
//!
//! Why PKCE: Discord's `messages.read` scope is gated to verified apps, so we
//! can't legitimately read user DMs/channel messages. What we *can* read with
//! plain `identify` + `guilds` scopes is the user's profile and server list —
//! enough to render a real bespoke tile that shows who you are and where you
//! hang out. PKCE means the user only needs to register a "Public Client"
//! Discord app (no client_secret) and paste the client_id into our tile.
//!
//! Setup the user does once:
//!   1. https://discord.com/developers/applications → New Application
//!   2. OAuth2 → Redirects → add `http://localhost:14201/callback`
//!   3. Copy the Application ID (client_id)
//!   4. Paste it in our tile's "Connect Discord" prompt
//!
//! After that, "Connect" opens the browser, user clicks Authorize once, and
//! we cache the access+refresh tokens to %APPDATA%/Second-Monitor Hub/.

use base64::Engine;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Cursor,
    path::PathBuf,
    process::Command,
    sync::Arc,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, Runtime};

const REDIRECT_PORT: u16 = 14201;
const REDIRECT_URI: &str = "http://localhost:14201/callback";
const SCOPES: &str = "identify guilds rpc rpc.notifications.read rpc.voice.read rpc.voice.write";
const POLL_INTERVAL_SECS: u64 = 60;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DiscordUser {
    pub id: String,
    pub username: String,
    #[serde(default)]
    pub global_name: Option<String>,
    #[serde(default)]
    pub discriminator: String,
    #[serde(default)]
    pub avatar: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DiscordGuild {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub icon: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct DiscordState {
    pub connected: bool,
    pub connecting: bool,
    pub error: Option<String>,
    pub user: Option<DiscordUser>,
    pub guilds: Vec<DiscordGuild>,
    /// True once a successful poll has produced data; lets the UI distinguish
    /// "connecting → waiting on first fetch" from "connected with data".
    pub has_data: bool,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
struct StoredCreds {
    client_id: Option<String>,
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_at: Option<u64>,
    /// Space-separated list of OAuth scopes Discord actually granted us.
    /// Used by the RPC module to detect missing scopes before subscribing.
    #[serde(default)]
    granted_scopes: Option<String>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
    expires_in: u64,
    #[serde(default)]
    scope: String,
}

static STATE: Lazy<Mutex<DiscordState>> = Lazy::new(|| Mutex::new(DiscordState::default()));
static CREDS: Lazy<Mutex<StoredCreds>> = Lazy::new(|| Mutex::new(StoredCreds::default()));

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn creds_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    let _ = fs::create_dir_all(&dir);
    Some(dir.join("discord.json"))
}

fn load_creds<R: Runtime>(app: &AppHandle<R>) -> StoredCreds {
    let Some(path) = creds_path(app) else { return StoredCreds::default() };
    let Ok(bytes) = fs::read(&path) else { return StoredCreds::default() };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

fn save_creds<R: Runtime>(app: &AppHandle<R>, creds: &StoredCreds) {
    if let Some(path) = creds_path(app) {
        if let Ok(bytes) = serde_json::to_vec_pretty(creds) {
            let _ = fs::write(path, bytes);
        }
    }
}

fn emit_state<R: Runtime>(app: &AppHandle<R>) {
    let state = STATE.lock().clone();
    let _ = app.emit("discord:state", &state);
}

fn random_verifier() -> String {
    let mut bytes = [0u8; 64];
    rand::thread_rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn pkce_challenge(verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(hasher.finalize())
}

fn open_browser(url: &str) -> Result<(), String> {
    // Avoid `cmd /C start ...` — cmd interprets `&` as a command separator,
    // which silently strips everything after the first `&` in our query
    // string (so client_id, redirect_uri, etc. all get lost). rundll32 isn't
    // a shell, so the URL is passed through to the default browser intact.
    Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", url])
        .spawn()
        .map_err(|e| format!("open browser: {e}"))?;
    Ok(())
}

/// Sentinel error for a user-initiated cancel — the caller resets state
/// WITHOUT surfacing an error message (cancelling is not a failure).
pub const CONNECT_CANCELLED: &str = "__connect_cancelled__";

/// Set by `discord_cancel_connect`; polled by `wait_for_callback`'s loop.
static CANCEL_CONNECT: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// How long we wait for Discord to redirect back. Was 300s (0.9.5): with a
/// mistyped Application ID Discord shows its own error page and NEVER
/// redirects, so the wait always ran to the full deadline with the button
/// stuck on "Authorizing…". 120s leaves room for a real Discord login;
/// the Cancel button covers the impatient path.
const CALLBACK_DEADLINE: Duration = Duration::from_secs(120);

/// Block until exactly one valid HTTP request hits the redirect port, return
/// the `code` query param. Sends a friendly HTML response so the browser tab
/// shows confirmation and self-closes. Chrome fetches favicon.ico on the
/// callback page, so we may need to consume a few stray requests before we
/// see one with a code. Waits in 500ms slices so a cancel lands promptly.
fn wait_for_callback() -> Result<String, String> {
    let server = tiny_http::Server::http(("127.0.0.1", REDIRECT_PORT))
        .map_err(|e| format!("bind callback server: {e}"))?;

    let deadline = std::time::Instant::now() + CALLBACK_DEADLINE;
    loop {
        if CANCEL_CONNECT.load(std::sync::atomic::Ordering::Relaxed) {
            return Err(CONNECT_CANCELLED.into());
        }
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            return Err(
                "Didn't hear back from Discord — check that the Application ID is correct \
                 and that http://localhost:14201/callback is added under OAuth2 → Redirects"
                    .into(),
            );
        }
        let slice = remaining.min(Duration::from_millis(500));
        let request = match server.recv_timeout(slice) {
            Ok(Some(r)) => r,
            Ok(None) => continue, // slice elapsed — re-check cancel/deadline
            Err(e) => return Err(format!("recv: {e}")),
        };

        let url = request.url().to_string();
        let code = url
            .split_once('?')
            .and_then(|(_, q)| q.split('&').find_map(|kv| kv.strip_prefix("code=")))
            .map(|s| s.to_string());
        let error = url
            .split_once('?')
            .and_then(|(_, q)| q.split('&').find_map(|kv| kv.strip_prefix("error=")))
            .map(|s| s.to_string());

        let body = if code.is_some() {
            "<!doctype html><html><body style=\"font-family:system-ui;padding:40px;background:#06070a;color:#eee\"><h2>Connected ✓</h2><p>You can close this tab.</p><script>setTimeout(()=>window.close(),1500)</script></body></html>"
        } else {
            "<!doctype html><html><body style=\"font-family:system-ui;padding:40px;background:#06070a;color:#fca5a5\"><h2>Discord auth failed</h2><p>Check the application logs.</p></body></html>"
        };
        let response = tiny_http::Response::from_data(body.as_bytes()).with_header(
            tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..])
                .unwrap(),
        );
        let _ = request.respond(response);

        if let Some(c) = code {
            return Ok(c);
        }
        if let Some(e) = error {
            return Err(format!("Discord returned error: {e}"));
        }
        // Stray request (favicon, etc) — keep waiting.
    }
}

fn exchange_code(client_id: &str, code: &str, verifier: &str) -> Result<TokenResponse, String> {
    ureq::post("https://discord.com/api/oauth2/token")
        .set("Content-Type", "application/x-www-form-urlencoded")
        .send_form(&[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("client_id", client_id),
            ("redirect_uri", REDIRECT_URI),
            ("code_verifier", verifier),
        ])
        .map_err(|e| format!("token exchange: {e}"))?
        .into_json()
        .map_err(|e| format!("token parse: {e}"))
}

/// `Err(revoked)` — the bool says whether the GRANT itself is dead
/// (`invalid_grant` from the token endpoint) as opposed to a transient
/// network/server failure. Callers must only erase stored credentials when
/// it is true (0.9.2): a single offline launch used to wipe the tokens and
/// force a full browser re-authorize.
fn refresh_tokens(client_id: &str, refresh_token: &str) -> Result<TokenResponse, (String, bool)> {
    let resp = ureq::post("https://discord.com/api/oauth2/token")
        .set("Content-Type", "application/x-www-form-urlencoded")
        .send_form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", client_id),
        ]);
    match resp {
        Ok(r) => r
            .into_json()
            // A 2xx we can't parse is a server hiccup, not a revocation.
            .map_err(|e| (format!("refresh parse: {e}"), false)),
        Err(ureq::Error::Status(status, r)) => {
            let text = r.into_string().unwrap_or_default();
            let revoked = status == 400 && text.contains("invalid_grant");
            Err((format!("refresh: HTTP {status}"), revoked))
        }
        Err(e) => Err((format!("refresh: {e}"), false)),
    }
}

fn fetch_user(token: &str) -> Result<DiscordUser, String> {
    ureq::get("https://discord.com/api/v10/users/@me")
        .set("Authorization", &format!("Bearer {token}"))
        .call()
        .map_err(|e| format!("/users/@me: {e}"))?
        .into_json()
        .map_err(|e| format!("/users/@me parse: {e}"))
}

fn fetch_guilds(token: &str) -> Result<Vec<DiscordGuild>, String> {
    ureq::get("https://discord.com/api/v10/users/@me/guilds")
        .set("Authorization", &format!("Bearer {token}"))
        .call()
        .map_err(|e| format!("/users/@me/guilds: {e}"))?
        .into_json()
        .map_err(|e| format!("/users/@me/guilds parse: {e}"))
}

/// Returns the access token, refreshing if expired. Saves to disk on refresh.
fn ensure_token<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    let creds = CREDS.lock();
    let access = creds.access_token.clone()?;
    let client_id = creds.client_id.clone()?;
    let refresh = creds.refresh_token.clone();
    let expires_at = creds.expires_at.unwrap_or(0);

    // Refresh 60s before expiry.
    if expires_at > now_secs() + 60 {
        return Some(access);
    }
    let Some(refresh_tok) = refresh else { return Some(access) };
    drop(creds);

    match refresh_tokens(&client_id, &refresh_tok) {
        Ok(t) => {
            let mut c = CREDS.lock();
            c.access_token = Some(t.access_token.clone());
            c.refresh_token = Some(t.refresh_token);
            c.expires_at = Some(now_secs() + t.expires_in);
            save_creds(app, &c);
            Some(t.access_token)
        }
        Err((e, revoked)) => {
            if revoked {
                // Discord said invalid_grant: the grant is provably dead —
                // erasing is correct and the Connect flow is the only way on.
                eprintln!("discord: refresh rejected (invalid_grant) — clearing tokens");
                let mut c = CREDS.lock();
                c.access_token = None;
                c.refresh_token = None;
                c.expires_at = None;
                save_creds(app, &c);
                None
            } else {
                // Transient (offline at login, Discord 5xx): keep the stored
                // grant untouched and let the next poll retry. Before 0.9.2
                // this arm ERASED the tokens from disk, so one bad moment
                // meant re-authorizing in the browser forever after.
                eprintln!("discord: refresh failed transiently: {e} — keeping stored grant");
                None
            }
        }
    }
}

fn poll<R: Runtime>(app: &AppHandle<R>) {
    let Some(token) = ensure_token(app) else {
        let mut s = STATE.lock();
        if s.connected {
            *s = DiscordState::default();
            drop(s);
            emit_state(app);
        }
        return;
    };

    let user = fetch_user(&token);
    let guilds = fetch_guilds(&token);

    let mut s = STATE.lock();
    s.connected = true;
    s.connecting = false;
    match (user, guilds) {
        (Ok(u), Ok(g)) => {
            s.user = Some(u);
            s.guilds = g;
            s.error = None;
            s.has_data = true;
        }
        (Err(e), _) | (_, Err(e)) => {
            s.error = Some(e);
        }
    }
    drop(s);
    emit_state(app);
}

pub fn spawn<R: Runtime>(app: AppHandle<R>) {
    *CREDS.lock() = load_creds(&app);
    // If we already have creds from a previous run, mark connected (poll will refine).
    {
        let creds = CREDS.lock();
        let mut s = STATE.lock();
        if creds.access_token.is_some() {
            s.connected = true;
        }
    }
    emit_state(&app);

    let app2 = app.clone();
    thread::spawn(move || loop {
        poll(&app2);
        thread::sleep(Duration::from_secs(POLL_INTERVAL_SECS));
    });
}

#[tauri::command]
pub async fn discord_connect<R: Runtime>(app: AppHandle<R>, client_id: String) -> Result<(), String> {
    let client_id = client_id.trim().to_string();
    if client_id.is_empty() {
        return Err("client_id is empty".into());
    }

    {
        let mut s = STATE.lock();
        s.connecting = true;
        s.error = None;
        drop(s);
        emit_state(&app);
    }
    // A fresh attempt clears any stale cancel from a previous one.
    CANCEL_CONNECT.store(false, std::sync::atomic::Ordering::Relaxed);

    // spawn_blocking (0.9.5): this body blocks for up to the whole callback
    // deadline — parked directly on a tokio worker it was the same
    // starve-the-runtime shape the 0.9.2 audit cleaned out elsewhere.
    let result = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        let client_id = client_id.clone();
        move || -> Result<(), String> {
            let verifier = random_verifier();
            let challenge = pkce_challenge(&verifier);
            let auth_url = format!(
                "https://discord.com/api/oauth2/authorize?response_type=code&client_id={cid}&scope={scope}&redirect_uri={ru}&code_challenge={ch}&code_challenge_method=S256",
                cid = client_id,
                scope = SCOPES.replace(' ', "+"),
                ru = "http%3A%2F%2Flocalhost%3A14201%2Fcallback",
                ch = challenge,
            );
            open_browser(&auth_url)?;
            let code = wait_for_callback()?;
            let tokens = exchange_code(&client_id, &code, &verifier)?;
            eprintln!("discord: token granted with scopes = [{}]", tokens.scope);
            let mut creds = CREDS.lock();
            creds.client_id = Some(client_id.clone());
            creds.access_token = Some(tokens.access_token);
            creds.refresh_token = Some(tokens.refresh_token);
            creds.expires_at = Some(now_secs() + tokens.expires_in);
            creds.granted_scopes = Some(tokens.scope);
            save_creds(&app, &creds);
            drop(creds);
            Ok(())
        }
    })
    .await
    .map_err(|e| format!("connect task failed: {e}"))
    .and_then(|r| r);

    if let Err(ref e) = result {
        let mut s = STATE.lock();
        s.connecting = false;
        // A user-initiated cancel is not a failure — no error banner, just
        // back to the editable form.
        s.error = if e == CONNECT_CANCELLED { None } else { Some(e.clone()) };
        drop(s);
        emit_state(&app);
        if e == CONNECT_CANCELLED {
            return Ok(());
        }
    } else {
        // Kick a poll right away so the UI updates before the next tick.
        poll(&app);
    }
    result
}

/// Aborts a pending `discord_connect`: the waiting loop notices within
/// ~500ms, unwinds, and the connect command itself resets `connecting` and
/// emits — so the tile returns to the editable form without a restart.
#[tauri::command]
pub async fn discord_cancel_connect() {
    CANCEL_CONNECT.store(true, std::sync::atomic::Ordering::Relaxed);
}

#[tauri::command]
pub async fn discord_disconnect<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    {
        let mut creds = CREDS.lock();
        *creds = StoredCreds { client_id: creds.client_id.clone(), ..Default::default() };
        save_creds(&app, &creds);
    }
    {
        let mut s = STATE.lock();
        let cid = CREDS.lock().client_id.clone();
        let _ = cid; // keep client_id around for re-connect convenience
        *s = DiscordState::default();
    }
    emit_state(&app);
    Ok(())
}

#[tauri::command]
pub async fn discord_status() -> DiscordState {
    STATE.lock().clone()
}

#[tauri::command]
pub async fn discord_get_client_id() -> Option<String> {
    CREDS.lock().client_id.clone()
}

/// Internal accessors so the RPC module (which lives in a sibling file) can
/// piggyback on the same OAuth tokens without re-authenticating.
pub fn current_access_token() -> Option<String> {
    CREDS.lock().access_token.clone()
}

pub fn current_client_id() -> Option<String> {
    CREDS.lock().client_id.clone()
}

pub fn current_granted_scopes() -> Option<String> {
    CREDS.lock().granted_scopes.clone()
}

// suppressed unused warnings on non-Windows fields
#[allow(dead_code)]
fn _silence(_: Arc<()>, _: Cursor<()>) {}
