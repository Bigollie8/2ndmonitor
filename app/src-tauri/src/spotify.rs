//! Spotify Web API integration via OAuth-PKCE.
//!
//! User pastes their Spotify Developer App's Client ID. We open the system
//! browser to the authorize URL with redirect to http://localhost:14202/callback,
//! catch the code, exchange for an access + refresh token, and store both at
//! `app_config_dir()/spotify.json`. A unified polling worker hits `/me/player`
//! every 5 s for current device + volume, and `/me/player/queue` every other
//! tick (10 s effective) for the upcoming-track list. State diffs emit on
//! `spotify:state`; queue snapshots also emit on `spotify:queue`.

use base64::Engine;
use parking_lot::Mutex;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Digest;
use std::fs;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, Runtime};

const REDIRECT_URI: &str = "http://127.0.0.1:14202/callback";
const CALLBACK_PORT: u16 = 14202;
const PLAYER_POLL_SECS: u64 = 5;
// /me/player/queue is hit every other player tick (so 10 s effective cadence,
// matching the previous QUEUE_POLL_SECS behaviour).
const SCOPES: &str = "user-read-currently-playing user-read-playback-state user-modify-playback-state";

#[derive(Default, Serialize, Deserialize, Clone)]
struct StoredCreds {
    client_id: Option<String>,
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_at: Option<u64>,
}

#[derive(Default, Serialize, Clone, Debug)]
pub struct SpotifyTrack {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub art_url: Option<String>,
    pub duration_ms: u64,
}

#[derive(Default, Serialize, Clone)]
pub struct SpotifyState {
    pub connected: bool,
    pub connecting: bool,
    pub error: Option<String>,
    pub queue: Vec<SpotifyTrack>,
    pub premium_required: bool,
    pub volume_percent: Option<u8>,    // 0..=100, None when no active device
    pub device_id: Option<String>,
    pub device_name: Option<String>,
    pub volume_supported: bool,         // mirrors device.supports_volume
    pub needs_reauth: bool,             // true when API returned insufficient_scope
}

static CREDS: once_cell::sync::Lazy<Mutex<StoredCreds>> = once_cell::sync::Lazy::new(|| Mutex::new(StoredCreds::default()));
static STATE: once_cell::sync::Lazy<Mutex<SpotifyState>> = once_cell::sync::Lazy::new(|| Mutex::new(SpotifyState::default()));

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn creds_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    let _ = fs::create_dir_all(&dir);
    Some(dir.join("spotify.json"))
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
    let s = STATE.lock().clone();
    let _ = app.emit("spotify:state", &s);
}

fn emit_queue<R: Runtime>(app: &AppHandle<R>, queue: &[SpotifyTrack]) {
    let _ = app.emit("spotify:queue", queue);
}

fn random_verifier() -> String {
    let mut bytes = [0u8; 64];
    rand::thread_rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn pkce_challenge(verifier: &str) -> String {
    let digest = sha2::Sha256::digest(verifier.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest)
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.as_bytes() {
        let c = *b;
        let safe = (c as char).is_ascii_alphanumeric() || c == b'-' || c == b'_' || c == b'.' || c == b'~';
        if safe { out.push(c as char); } else { out.push_str(&format!("%{:02X}", c)); }
    }
    out
}

pub fn spawn<R: Runtime>(app: AppHandle<R>) {
    {
        let creds = load_creds(&app);
        *CREDS.lock() = creds.clone();
        let mut s = STATE.lock();
        // A stored refresh grant counts as connected even when the (1-hour)
        // access token has long expired — the poll worker's first tick
        // refreshes it. Before 0.9.2 an expired-but-refreshable session
        // started "connected" and then dropped to the Connect form the
        // moment one refresh attempt failed transiently.
        s.connected = creds.access_token.is_some() || creds.refresh_token.is_some();
    }
    emit_state(&app);

    let app_poll = app.clone();
    std::thread::spawn(move || poll_worker(app_poll));
}

fn poll_worker<R: Runtime>(app: AppHandle<R>) {
    let mut tick: u64 = 0;
    loop {
        let connected = STATE.lock().connected;
        let has_grant = CREDS.lock().refresh_token.is_some();
        if connected {
            apply_player(&app);
            // Hit /me/player/queue every other tick → 10 s effective cadence.
            if tick % 2 == 0 {
                apply_queue(&app);
            }
        } else if has_grant && tick % 6 == 0 {
            // Self-heal (0.9.2): disconnected but a grant survives on disk —
            // e.g. a 401 raced a refresh, or a pre-0.9.2 build dropped the
            // session. Try roughly every 30 s; only finish_exchange used to
            // be able to set `connected` back, which required the browser.
            if try_refresh(&app) == RefreshOutcome::Refreshed {
                let mut s = STATE.lock();
                s.connected = true;
                s.error = None;
                drop(s);
                emit_state(&app);
            }
        }
        tick = tick.wrapping_add(1);
        std::thread::sleep(Duration::from_secs(PLAYER_POLL_SECS));
    }
}

fn apply_player<R: Runtime>(app: &AppHandle<R>) {
    match fetch_player(app) {
        Ok(Some(d)) => {
            let mut s = STATE.lock();
            s.volume_percent = d.volume_percent;
            s.device_id = d.id;
            s.device_name = d.name;
            s.volume_supported = d.supports_volume.unwrap_or(false);
            s.error = None;
            drop(s);
            emit_state(app);
        }
        Ok(None) => {
            let mut s = STATE.lock();
            s.volume_percent = None;
            s.device_id = None;
            s.device_name = None;
            s.volume_supported = false;
            s.error = None;
            drop(s);
            emit_state(app);
        }
        Err(ApiErr::PremiumRequired) => {
            let mut s = STATE.lock();
            s.premium_required = true;
            drop(s);
            emit_state(app);
        }
        Err(ApiErr::Unauthorized) => {
            let mut s = STATE.lock();
            s.error = Some("Spotify auth expired — reconnect".into());
            s.connected = false;
            drop(s);
            emit_state(app);
        }
        Err(ApiErr::Transient) => {
            // Network down / Spotify 5xx: the grant is still good. Keep the
            // session; the next 5 s tick retries. (0.9.2 — this used to drop
            // to the Connect form, forcing a browser re-authorize.)
            let mut s = STATE.lock();
            s.error = Some("Spotify unreachable — retrying".into());
            drop(s);
            emit_state(app);
        }
        Err(ApiErr::Other(e)) => {
            eprintln!("spotify player: {e}");
        }
    }
}

fn apply_queue<R: Runtime>(app: &AppHandle<R>) {
    match fetch_queue(app) {
        Ok(queue) => {
            {
                let mut s = STATE.lock();
                s.queue = queue.clone();
                s.error = None;
                s.premium_required = false;
            }
            emit_state(app);
            emit_queue(app, &queue);
        }
        Err(ApiErr::PremiumRequired) => {
            let mut s = STATE.lock();
            s.premium_required = true;
            s.queue.clear();
            drop(s);
            emit_state(app);
        }
        Err(ApiErr::Unauthorized) => {
            let mut s = STATE.lock();
            s.error = Some("Spotify auth expired — reconnect".into());
            s.connected = false;
            drop(s);
            emit_state(app);
        }
        Err(ApiErr::Transient) => {
            // Same as apply_player: soft banner, keep the session, retry on
            // the next tick.
            let mut s = STATE.lock();
            s.error = Some("Spotify unreachable — retrying".into());
            drop(s);
            emit_state(app);
        }
        Err(ApiErr::Other(e)) => {
            eprintln!("spotify queue: {e}");
        }
    }
}

#[derive(Debug)]
enum ApiErr {
    PremiumRequired,
    /// The GRANT is gone (revoked or never existed) — only this drops the
    /// session to the Connect form.
    Unauthorized,
    /// Network/server trouble; the session stays connected and the next poll
    /// tick retries. Surfaced as a soft banner, never the Connect form.
    Transient,
    Other(String),
}

#[derive(Deserialize)]
struct QueueResp {
    queue: Option<Vec<SpotifyItem>>,
}
#[derive(Deserialize)]
struct SpotifyItem {
    id: Option<String>,
    name: Option<String>,
    duration_ms: Option<u64>,
    artists: Option<Vec<SpotifyArtist>>,
    album: Option<SpotifyAlbum>,
}
#[derive(Deserialize)]
struct SpotifyArtist { name: Option<String> }
#[derive(Deserialize)]
#[allow(dead_code)]
struct SpotifyAlbum {
    name: Option<String>,
    images: Option<Vec<SpotifyImage>>,
}
#[derive(Deserialize)]
#[allow(dead_code)]
struct SpotifyImage { url: String, width: Option<u32>, height: Option<u32> }

#[derive(Deserialize)]
struct PlayerResp {
    device: Option<PlayerDevice>,
}

#[derive(Deserialize)]
struct PlayerDevice {
    id: Option<String>,
    name: Option<String>,
    volume_percent: Option<u8>,
    supports_volume: Option<bool>,
}

fn fetch_queue<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<SpotifyTrack>, ApiErr> {
    let token = ensure_fresh_token(app)?;
    let resp = ureq::get("https://api.spotify.com/v1/me/player/queue")
        .set("Authorization", &format!("Bearer {token}"))
        .timeout(Duration::from_secs(8))
        .call();
    match resp {
        Ok(r) => {
            let q: QueueResp = r.into_json().map_err(|e| ApiErr::Other(e.to_string()))?;
            let items = q.queue.unwrap_or_default();
            Ok(items.into_iter().take(20).map(map_item).collect())
        }
        Err(ureq::Error::Status(401, _)) => {
            // One more refresh attempt then bail — and only a REVOKED grant
            // bails to Unauthorized; a transient refresh failure keeps the
            // session for the next tick.
            match try_refresh(app) {
                RefreshOutcome::Refreshed => {
                    let token = CREDS.lock().access_token.clone().ok_or(ApiErr::Unauthorized)?;
                    let r2 = ureq::get("https://api.spotify.com/v1/me/player/queue")
                        .set("Authorization", &format!("Bearer {token}"))
                        .timeout(Duration::from_secs(8))
                        .call().map_err(|e| ApiErr::Other(e.to_string()))?;
                    let q: QueueResp = r2.into_json().map_err(|e| ApiErr::Other(e.to_string()))?;
                    Ok(q.queue.unwrap_or_default().into_iter().take(20).map(map_item).collect())
                }
                RefreshOutcome::Transient => Err(ApiErr::Transient),
                RefreshOutcome::Revoked => Err(ApiErr::Unauthorized),
            }
        }
        Err(ureq::Error::Status(403, _)) => Err(ApiErr::PremiumRequired),
        Err(ureq::Error::Status(404, _)) => Ok(Vec::new()), // no active player
        Err(e) => Err(ApiErr::Other(e.to_string())),
    }
}

fn fetch_player<R: Runtime>(app: &AppHandle<R>) -> Result<Option<PlayerDevice>, ApiErr> {
    let token = ensure_fresh_token(app)?;
    let resp = ureq::get("https://api.spotify.com/v1/me/player")
        .set("Authorization", &format!("Bearer {token}"))
        .timeout(Duration::from_secs(8))
        .call();
    match resp {
        Ok(r) => {
            // Spotify returns 204 No Content when no device is active. ureq
            // surfaces 204 as Ok with an empty body — `into_json` would fail,
            // so check status first.
            if r.status() == 204 {
                return Ok(None);
            }
            let p: PlayerResp = r.into_json().map_err(|e| ApiErr::Other(e.to_string()))?;
            Ok(p.device)
        }
        Err(ureq::Error::Status(401, _)) => {
            match try_refresh(app) {
                RefreshOutcome::Refreshed => {
                    let token = CREDS.lock().access_token.clone().ok_or(ApiErr::Unauthorized)?;
                    let r2 = ureq::get("https://api.spotify.com/v1/me/player")
                        .set("Authorization", &format!("Bearer {token}"))
                        .timeout(Duration::from_secs(8))
                        .call().map_err(|e| ApiErr::Other(e.to_string()))?;
                    if r2.status() == 204 { return Ok(None); }
                    let p: PlayerResp = r2.into_json().map_err(|e| ApiErr::Other(e.to_string()))?;
                    Ok(p.device)
                }
                RefreshOutcome::Transient => Err(ApiErr::Transient),
                RefreshOutcome::Revoked => Err(ApiErr::Unauthorized),
            }
        }
        Err(ureq::Error::Status(403, _)) => Err(ApiErr::PremiumRequired),
        Err(ureq::Error::Status(404, _)) => Ok(None), // no active player
        Err(e) => Err(ApiErr::Other(e.to_string())),
    }
}

fn map_item(it: SpotifyItem) -> SpotifyTrack {
    let art = it.album.as_ref()
        .and_then(|a| a.images.as_ref())
        .and_then(|imgs| imgs.iter().find(|i| i.width.unwrap_or(0) <= 64).or_else(|| imgs.last()))
        .map(|i| i.url.clone());
    let artist = it.artists
        .map(|v| v.into_iter().filter_map(|a| a.name).collect::<Vec<_>>().join(", "))
        .unwrap_or_default();
    SpotifyTrack {
        id: it.id.unwrap_or_default(),
        title: it.name.unwrap_or_default(),
        artist,
        album: it.album.and_then(|a| a.name).unwrap_or_default(),
        art_url: art,
        duration_ms: it.duration_ms.unwrap_or(0),
    }
}

fn ensure_fresh_token<R: Runtime>(app: &AppHandle<R>) -> Result<String, ApiErr> {
    let creds = CREDS.lock().clone();
    if let Some(access) = creds.access_token.clone() {
        if creds.expires_at.unwrap_or(0) > now_secs() + 60 {
            return Ok(access);
        }
    } else if creds.refresh_token.is_none() {
        // Nothing stored at all — genuinely not connected.
        return Err(ApiErr::Unauthorized);
    }
    // Expired (the normal case at every launch — access tokens live 1 hour)
    // or access token missing but a refresh grant survives: refresh, and let
    // the outcome say whether the session is over or merely unreachable.
    match try_refresh(app) {
        RefreshOutcome::Refreshed => {
            CREDS.lock().access_token.clone().ok_or(ApiErr::Unauthorized)
        }
        RefreshOutcome::Transient => Err(ApiErr::Transient),
        RefreshOutcome::Revoked => Err(ApiErr::Unauthorized),
    }
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct TokenResp {
    access_token: String,
    token_type: Option<String>,
    expires_in: Option<u64>,
    refresh_token: Option<String>,
    scope: Option<String>,
}

/// How a refresh attempt ended. The distinction is the whole 0.9.2 fix: the
/// old bool collapsed "network was down for 8 seconds" and "Spotify revoked
/// the grant" into the same `false`, and the caller responded to both by
/// dropping to the Connect form — which is why testers had to re-authorize
/// in the browser on practically every launch (access tokens live an hour,
/// so almost every startup begins with a refresh).
#[derive(Debug, Clone, Copy, PartialEq)]
enum RefreshOutcome {
    Refreshed,
    /// Try again later; the stored grant is still presumed good.
    Transient,
    /// Spotify said `invalid_grant`: the refresh token is dead. This is the
    /// ONLY outcome that erases stored credentials and surfaces the
    /// interactive Connect flow again.
    Revoked,
}

/// Serializes refreshes across the poll thread and command handlers
/// (`spotify_set_volume`'s 401 path). Spotify rotates PKCE refresh tokens:
/// two concurrent refreshes spend the same token, and the loser's rotated
/// token is permanently invalid — a self-inflicted `Revoked`.
static REFRESH_LOCK: once_cell::sync::Lazy<Mutex<()>> =
    once_cell::sync::Lazy::new(|| Mutex::new(()));

fn try_refresh<R: Runtime>(app: &AppHandle<R>) -> RefreshOutcome {
    let _serialized = REFRESH_LOCK.lock();
    let creds = CREDS.lock().clone();
    let Some(client_id) = creds.client_id else { return RefreshOutcome::Revoked };
    let Some(refresh_token) = creds.refresh_token else { return RefreshOutcome::Revoked };
    // Another caller may have refreshed while we waited on the lock — if the
    // token is fresh again, don't spend the rotated refresh token twice.
    if creds.expires_at.unwrap_or(0) > now_secs() + 60 {
        return RefreshOutcome::Refreshed;
    }
    let body = format!(
        "grant_type=refresh_token&refresh_token={}&client_id={}",
        urlencode(&refresh_token), urlencode(&client_id),
    );
    let resp = ureq::post("https://accounts.spotify.com/api/token")
        .set("Content-Type", "application/x-www-form-urlencoded")
        .timeout(Duration::from_secs(8))
        .send_string(&body);
    let r = match resp {
        Ok(r) => r,
        Err(ureq::Error::Status(status, r)) => {
            let text = r.into_string().unwrap_or_default();
            // Spotify's token endpoint answers a dead/revoked refresh token
            // with 400 `invalid_grant`. Anything else (5xx, rate limit,
            // invalid_client on a misconfigured id) is not proof the GRANT
            // is gone — keep the session and let a later attempt decide.
            if status == 400 && text.contains("invalid_grant") {
                let mut c = CREDS.lock();
                c.access_token = None;
                c.refresh_token = None;
                c.expires_at = None;
                save_creds(app, &c);
                return RefreshOutcome::Revoked;
            }
            eprintln!("spotify refresh: HTTP {status} (treated as transient)");
            return RefreshOutcome::Transient;
        }
        Err(e) => {
            eprintln!("spotify refresh: transport error (treated as transient): {e}");
            return RefreshOutcome::Transient;
        }
    };
    // A 2xx whose body we can't parse is a server hiccup, not a revocation.
    let Ok(tok): Result<TokenResp, _> = r.into_json() else { return RefreshOutcome::Transient };
    let mut c = CREDS.lock();
    c.access_token = Some(tok.access_token);
    if let Some(rt) = tok.refresh_token { c.refresh_token = Some(rt); }
    c.expires_at = Some(now_secs() + tok.expires_in.unwrap_or(3600));
    save_creds(app, &c);
    RefreshOutcome::Refreshed
}

#[tauri::command]
pub async fn spotify_status() -> SpotifyState {
    STATE.lock().clone()
}

#[tauri::command]
pub async fn spotify_get_client_id() -> Option<String> {
    CREDS.lock().client_id.clone()
}

#[tauri::command]
pub async fn spotify_disconnect<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    {
        let mut c = CREDS.lock();
        c.access_token = None;
        c.refresh_token = None;
        c.expires_at = None;
        save_creds(&app, &c);
    }
    {
        let mut s = STATE.lock();
        s.connected = false;
        s.queue.clear();
        s.error = None;
        s.premium_required = false;
        s.needs_reauth = false;
        s.volume_percent = None;
        s.device_id = None;
        s.device_name = None;
        s.volume_supported = false;
    }
    emit_state(&app);
    Ok(())
}

#[tauri::command]
pub async fn spotify_connect<R: Runtime>(app: AppHandle<R>, client_id: String) -> Result<(), String> {
    {
        let mut s = STATE.lock();
        s.connecting = true;
        s.error = None;
    }
    emit_state(&app);

    {
        let mut c = CREDS.lock();
        c.client_id = Some(client_id.clone());
        save_creds(&app, &c);
    }

    let verifier = random_verifier();
    let challenge = pkce_challenge(&verifier);
    let auth_url = format!(
        "https://accounts.spotify.com/authorize?client_id={}&response_type=code&redirect_uri={}&code_challenge_method=S256&code_challenge={}&scope={}",
        urlencode(&client_id),
        urlencode(REDIRECT_URI),
        urlencode(&challenge),
        urlencode(SCOPES),
    );

    let app_inner = app.clone();
    std::thread::spawn(move || {
        let server = match tiny_http::Server::http(("127.0.0.1", CALLBACK_PORT)) {
            Ok(s) => s,
            Err(e) => {
                let mut s = STATE.lock();
                s.connecting = false;
                s.error = Some(format!("callback server: {e}"));
                drop(s);
                emit_state(&app_inner);
                return;
            }
        };

        let _ = open_browser(&auth_url);

        let deadline = std::time::Instant::now() + Duration::from_secs(120);
        loop {
            match server.recv_timeout(Duration::from_secs(2)) {
                Ok(Some(req)) => {
                    let url = req.url().to_string();
                    if let Some(code) = extract_query_value(&url, "code") {
                        let body = "<html><body><h2>Spotify connected</h2><p>You can close this tab.</p></body></html>";
                        let resp = tiny_http::Response::from_string(body).with_header("Content-Type: text/html".parse::<tiny_http::Header>().unwrap());
                        let _ = req.respond(resp);
                        finish_exchange(&app_inner, &client_id, &code, &verifier);
                        return;
                    } else if let Some(err) = extract_query_value(&url, "error") {
                        let body = format!("<html><body><h2>Error: {err}</h2></body></html>");
                        let _ = req.respond(tiny_http::Response::from_string(body));
                        let mut s = STATE.lock();
                        s.connecting = false;
                        s.error = Some(format!("Spotify auth: {err}"));
                        drop(s);
                        emit_state(&app_inner);
                        return;
                    } else {
                        let _ = req.respond(tiny_http::Response::from_string("not found").with_status_code(404));
                    }
                }
                Ok(None) => {
                    if std::time::Instant::now() > deadline {
                        let mut s = STATE.lock();
                        s.connecting = false;
                        s.error = Some("Spotify auth timed out".into());
                        drop(s);
                        emit_state(&app_inner);
                        return;
                    }
                }
                Err(e) => {
                    eprintln!("spotify oauth recv: {e}");
                    return;
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn spotify_set_volume<R: Runtime>(app: AppHandle<R>, percent: u8) -> Result<(), String> {
    let percent = percent.min(100);

    // Snapshot device id before we PUT, then optimistically update local state
    // so the slider doesn't snap back before the next /me/player poll lands.
    let device_id = {
        let mut s = STATE.lock();
        s.volume_percent = Some(percent);
        s.device_id.clone()
    };
    emit_state(&app);

    // spawn_blocking (0.8.7 audit): this was the one async command issuing
    // blocking ureq calls in its async body — worst case (401 → refresh POST
    // → retry PUT) is three sequential 8s-timeout calls parked on a tokio
    // worker, which a few slider drags on a bad network could multiply into
    // starving the runtime's small worker pool.
    tauri::async_runtime::spawn_blocking(move || {
    let token = ensure_fresh_token(&app).map_err(|e| match e {
        ApiErr::Transient => "Spotify unreachable — try again".to_string(),
        _ => "Not connected".to_string(),
    })?;
    let mut url = format!(
        "https://api.spotify.com/v1/me/player/volume?volume_percent={percent}"
    );
    if let Some(id) = device_id.as_deref() {
        url.push_str("&device_id=");
        url.push_str(&urlencode(id));
    }

    // Classify a single ureq response. Used for both the first attempt and
    // the post-refresh retry. The retry's 401 must NOT trigger another
    // refresh — that's caller's responsibility — so this closure treats 401
    // as terminal "auth expired".
    let classify = |resp: Result<ureq::Response, ureq::Error>, app: &AppHandle<R>| -> Result<(), String> {
        match resp {
            Ok(_) => Ok(()),
            Err(ureq::Error::Status(401, _)) => Err("Spotify auth expired".into()),
            Err(ureq::Error::Status(403, r)) => {
                // 403 covers two cases:
                //   - PREMIUM_REQUIRED: free account
                //   - insufficient_scope: token predates the new scope
                // Spotify returns a JSON error body distinguishing them.
                let body = r.into_string().unwrap_or_default();
                if body.contains("insufficient_scope") {
                    let mut s = STATE.lock();
                    s.needs_reauth = true;
                    drop(s);
                    emit_state(app);
                    Err("Reconnect Spotify for playback control".into())
                } else if body.contains("PREMIUM_REQUIRED") {
                    let mut s = STATE.lock();
                    s.premium_required = true;
                    drop(s);
                    emit_state(app);
                    Err("Spotify Premium required".into())
                } else {
                    Err(format!("Spotify 403: {body}"))
                }
            }
            Err(ureq::Error::Status(404, _)) => Err("No active Spotify device".into()),
            Err(e) => Err(e.to_string()),
        }
    };

    let resp = ureq::put(&url)
        .set("Authorization", &format!("Bearer {token}"))
        .set("Content-Length", "0")
        .timeout(Duration::from_secs(8))
        .call();

    // First attempt: if it's 401, refresh once and retry. Anything else is
    // classified directly.
    if let Err(ureq::Error::Status(401, _)) = &resp {
        match try_refresh(&app) {
            RefreshOutcome::Refreshed => {}
            RefreshOutcome::Transient => return Err("Spotify unreachable — try again".into()),
            RefreshOutcome::Revoked => return Err("Spotify auth expired".into()),
        }
        let token = CREDS.lock().access_token.clone().ok_or("Auth refresh failed")?;
        let r2 = ureq::put(&url)
            .set("Authorization", &format!("Bearer {token}"))
            .set("Content-Length", "0")
            .timeout(Duration::from_secs(8))
            .call();
        return classify(r2, &app);
    }
    classify(resp, &app)
    })
    .await
    .map_err(|e| format!("volume task failed: {e}"))?
}

// ── Pick a song (0.9.4): play / queue / search ───────────────────────────────
// GSMTC can only skip; starting a CHOSEN track is Spotify-Web-API-only. The
// scope these need (user-modify-playback-state) has been requested since the
// volume feature, so most connected users need no re-authorize; a token from
// before that gets the existing insufficient_scope → Reconnect banner path.

/// True for exactly the URI shape the pick-a-song feature may play or queue:
/// `spotify:track:<alphanumeric id>`. An allowlist, not a parser — playlist/
/// album/artist contexts (and anything else a crafted queue row or search
/// result could carry) are refused before any request is made.
pub fn is_track_uri(uri: &str) -> bool {
    match uri.strip_prefix("spotify:track:") {
        Some(id) => {
            !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric())
        }
        None => false,
    }
}

/// The playback-control error taxonomy, shared by play/queue (same rules the
/// volume command established): 403 distinguishes insufficient_scope (flips
/// needs_reauth so the Reconnect banner shows) from PREMIUM_REQUIRED (free
/// account — playback control is a Premium API), 404 means no active device.
fn classify_control<R: Runtime>(
    resp: Result<ureq::Response, ureq::Error>,
    app: &AppHandle<R>,
) -> Result<(), String> {
    match resp {
        Ok(_) => Ok(()),
        Err(ureq::Error::Status(401, _)) => Err("Spotify auth expired".into()),
        Err(ureq::Error::Status(403, r)) => {
            let body = r.into_string().unwrap_or_default();
            if body.contains("insufficient_scope") {
                let mut s = STATE.lock();
                s.needs_reauth = true;
                drop(s);
                emit_state(app);
                Err("Reconnect Spotify to enable playback control".into())
            } else if body.contains("PREMIUM_REQUIRED") {
                let mut s = STATE.lock();
                s.premium_required = true;
                drop(s);
                emit_state(app);
                Err("Spotify Premium is required to control playback".into())
            } else {
                Err(format!("Spotify 403: {body}"))
            }
        }
        Err(ureq::Error::Status(404, _)) => {
            Err("No active Spotify device — start playback anywhere first".into())
        }
        Err(e) => Err(e.to_string()),
    }
}

/// One control call: fresh token, attempt, single 401-refresh retry, then
/// classify. Blocking — call from spawn_blocking only.
fn control_request<R: Runtime>(
    app: &AppHandle<R>,
    make: impl Fn(&str) -> Result<ureq::Response, ureq::Error>,
) -> Result<(), String> {
    let token = ensure_fresh_token(app).map_err(|e| match e {
        ApiErr::Transient => "Spotify unreachable — try again".to_string(),
        _ => "Not connected".to_string(),
    })?;
    let resp = make(&token);
    if let Err(ureq::Error::Status(401, _)) = &resp {
        match try_refresh(app) {
            RefreshOutcome::Refreshed => {}
            RefreshOutcome::Transient => return Err("Spotify unreachable — try again".into()),
            RefreshOutcome::Revoked => return Err("Spotify auth expired".into()),
        }
        let token = CREDS.lock().access_token.clone().ok_or("Auth refresh failed")?;
        return classify_control(make(&token), app);
    }
    classify_control(resp, app)
}

/// Start playing one specific track on the user's active device.
#[tauri::command]
pub async fn spotify_play<R: Runtime>(app: AppHandle<R>, uri: String) -> Result<(), String> {
    if !is_track_uri(&uri) {
        return Err("only spotify:track: URIs can be played".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let body = serde_json::json!({ "uris": [uri] }).to_string();
        control_request(&app, |token| {
            ureq::put("https://api.spotify.com/v1/me/player/play")
                .set("Authorization", &format!("Bearer {token}"))
                .set("Content-Type", "application/json")
                .timeout(Duration::from_secs(8))
                .send_string(&body)
        })
    })
    .await
    .map_err(|e| format!("play task failed: {e}"))?
}

/// Append one specific track to the user's queue.
#[tauri::command]
pub async fn spotify_queue_add<R: Runtime>(app: AppHandle<R>, uri: String) -> Result<(), String> {
    if !is_track_uri(&uri) {
        return Err("only spotify:track: URIs can be queued".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let url = format!(
            "https://api.spotify.com/v1/me/player/queue?uri={}",
            urlencode(&uri)
        );
        control_request(&app, |token| {
            ureq::post(&url)
                .set("Authorization", &format!("Bearer {token}"))
                .set("Content-Length", "0")
                .timeout(Duration::from_secs(8))
                .call()
        })
    })
    .await
    .map_err(|e| format!("queue task failed: {e}"))?
}

#[derive(Deserialize)]
struct SearchResp {
    tracks: Option<SearchTracks>,
}
#[derive(Deserialize)]
struct SearchTracks {
    items: Option<Vec<SpotifyItem>>,
}

/// Track search for pick-a-song. Read-only (no playback scope needed), so it
/// works on Free accounts too — only PLAYING the result is Premium-gated.
#[tauri::command]
pub async fn spotify_search<R: Runtime>(
    app: AppHandle<R>,
    query: String,
) -> Result<Vec<SpotifyTrack>, String> {
    let q = query.trim().to_string();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let token = ensure_fresh_token(&app).map_err(|e| match e {
            ApiErr::Transient => "Spotify unreachable — try again".to_string(),
            _ => "Not connected".to_string(),
        })?;
        let url = format!(
            "https://api.spotify.com/v1/search?type=track&limit=10&q={}",
            urlencode(&q)
        );
        let call = |token: &str| {
            ureq::get(&url)
                .set("Authorization", &format!("Bearer {token}"))
                .timeout(Duration::from_secs(8))
                .call()
        };
        let mut resp = call(&token);
        if let Err(ureq::Error::Status(401, _)) = &resp {
            match try_refresh(&app) {
                RefreshOutcome::Refreshed => {
                    let token = CREDS.lock().access_token.clone().ok_or("Auth refresh failed")?;
                    resp = call(&token);
                }
                RefreshOutcome::Transient => return Err("Spotify unreachable — try again".into()),
                RefreshOutcome::Revoked => return Err("Spotify auth expired".into()),
            }
        }
        let r = resp.map_err(|e| match e {
            ureq::Error::Status(code, _) => format!("Spotify search failed: HTTP {code}"),
            e => format!("Spotify search failed: {e}"),
        })?;
        let sr: SearchResp = r.into_json().map_err(|e| format!("search parse: {e}"))?;
        Ok(sr
            .tracks
            .and_then(|t| t.items)
            .unwrap_or_default()
            .into_iter()
            .take(10)
            .map(map_item)
            .collect())
    })
    .await
    .map_err(|e| format!("search task failed: {e}"))?
}

fn finish_exchange<R: Runtime>(app: &AppHandle<R>, client_id: &str, code: &str, verifier: &str) {
    let body = format!(
        "grant_type=authorization_code&code={}&redirect_uri={}&client_id={}&code_verifier={}",
        urlencode(code), urlencode(REDIRECT_URI), urlencode(client_id), urlencode(verifier),
    );
    let resp = ureq::post("https://accounts.spotify.com/api/token")
        .set("Content-Type", "application/x-www-form-urlencoded")
        .timeout(Duration::from_secs(8))
        .send_string(&body);
    let Ok(r) = resp else {
        let mut s = STATE.lock();
        s.connecting = false;
        s.error = Some("Spotify token exchange failed".into());
        drop(s);
        emit_state(app);
        return;
    };
    let Ok(tok): Result<TokenResp, _> = r.into_json() else {
        let mut s = STATE.lock();
        s.connecting = false;
        s.error = Some("Spotify token parse failed".into());
        drop(s);
        emit_state(app);
        return;
    };
    {
        let mut c = CREDS.lock();
        c.access_token = Some(tok.access_token);
        c.refresh_token = tok.refresh_token;
        c.expires_at = Some(now_secs() + tok.expires_in.unwrap_or(3600));
        save_creds(app, &c);
    }
    {
        let mut s = STATE.lock();
        s.connecting = false;
        s.connected = true;
        s.error = None;
    }
    emit_state(app);
}

fn extract_query_value(url: &str, key: &str) -> Option<String> {
    let q = url.split('?').nth(1)?;
    for pair in q.split('&') {
        let mut kv = pair.splitn(2, '=');
        let k = kv.next()?;
        let v = kv.next().unwrap_or("");
        if k == key {
            let decoded = v.replace('+', " ");
            return Some(percent_decode(&decoded));
        }
    }
    None
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(std::str::from_utf8(&bytes[i+1..i+3]).unwrap_or(""), 16) {
                out.push(b); i += 3; continue;
            }
        }
        out.push(bytes[i]); i += 1;
    }
    String::from_utf8(out).unwrap_or_default()
}

fn open_browser(url: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        // Avoid `cmd /C start ...` — cmd interprets `&` as a command separator,
        // which silently strips everything after the first `&` in our query
        // string (client_id, redirect_uri, etc. all get lost). rundll32 isn't
        // a shell, so the URL is passed through to the default browser intact.
        std::process::Command::new("rundll32.exe")
            .args(["url.dll,FileProtocolHandler", url])
            .spawn()
            .map_err(|e| format!("open browser: {e}"))?;
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        let _ = url;
        Err("non-windows browser open not implemented".into())
    }
}

// ── Musically-synced visuals: the beat/bar/section grid (0.9.10) ─────────────
//
// GET /v1/audio-analysis/{id} gives per-track beats, bars and sections —
// timing data no amplitude-reactive visual can derive. HONEST CAVEAT baked
// into the design: Spotify deprecated this endpoint for API apps created
// after Nov 2024; such apps get 403. A 403/404 is therefore a NORMAL outcome
// here, cached per track like a success, and the command returns None — the
// visual falls back to live onset envelopes rather than erroring.

#[derive(Serialize, Clone)]
pub struct SyncEvent {
    pub start: f64,
    pub duration: f64,
    pub confidence: f64,
}

#[derive(Serialize, Clone)]
pub struct SyncSection {
    pub start: f64,
    pub duration: f64,
    pub loudness: f64,
    pub tempo: f64,
}

#[derive(Serialize, Clone)]
pub struct SyncGrid {
    pub track_id: String,
    /// Player progress at fetch time + when it was read, so a consumer can
    /// correct a stale local position if it ever needs to.
    pub progress_ms: u64,
    pub fetched_at_ms: u64,
    pub playing: bool,
    pub beats: Vec<SyncEvent>,
    pub bars: Vec<SyncEvent>,
    pub sections: Vec<SyncSection>,
}

#[derive(Clone)]
struct AnalysisSlim {
    beats: Vec<SyncEvent>,
    bars: Vec<SyncEvent>,
    sections: Vec<SyncSection>,
}

/// Per-track analysis memo. `None` records "asked, unavailable" (403/404 —
/// deprecated endpoint or no analysis for this track) so one bad track or a
/// post-2024 API app can never cause a refetch loop at the poll cadence.
/// Bounded: cleared wholesale past 32 entries — a session rarely plays that
/// many distinct tracks, and a refetch after clearing is one request.
static ANALYSIS_CACHE: once_cell::sync::Lazy<Mutex<std::collections::HashMap<String, Option<AnalysisSlim>>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(std::collections::HashMap::new()));

#[derive(Deserialize)]
struct NowResp {
    progress_ms: Option<u64>,
    is_playing: Option<bool>,
    item: Option<SpotifyItem>,
}

#[derive(Deserialize)]
struct AnEvent {
    start: Option<f64>,
    duration: Option<f64>,
    confidence: Option<f64>,
}

#[derive(Deserialize)]
struct AnSection {
    start: Option<f64>,
    duration: Option<f64>,
    loudness: Option<f64>,
    tempo: Option<f64>,
}

#[derive(Deserialize)]
struct AnalysisResp {
    beats: Option<Vec<AnEvent>>,
    bars: Option<Vec<AnEvent>>,
    sections: Option<Vec<AnSection>>,
}

fn slim_events(v: Option<Vec<AnEvent>>, cap: usize) -> Vec<SyncEvent> {
    v.unwrap_or_default()
        .into_iter()
        .take(cap)
        .map(|e| SyncEvent {
            start: e.start.unwrap_or(0.0),
            duration: e.duration.unwrap_or(0.0),
            confidence: e.confidence.unwrap_or(0.0),
        })
        .collect()
}

/// Blocking — call from spawn_blocking only.
fn fetch_analysis_slim(token: &str, track_id: &str) -> Result<Option<AnalysisSlim>, ApiErr> {
    let url = format!("https://api.spotify.com/v1/audio-analysis/{track_id}");
    let resp = ureq::get(&url)
        .set("Authorization", &format!("Bearer {token}"))
        .timeout(Duration::from_secs(10))
        .call();
    match resp {
        Ok(r) => {
            let a: AnalysisResp = r.into_json().map_err(|e| ApiErr::Other(e.to_string()))?;
            Ok(Some(AnalysisSlim {
                // ~10 min at 180bpm fits well under these caps; they exist so
                // a pathological payload can't balloon the IPC message.
                beats: slim_events(a.beats, 4000),
                bars: slim_events(a.bars, 1200),
                sections: a
                    .sections
                    .unwrap_or_default()
                    .into_iter()
                    .take(120)
                    .map(|s| SyncSection {
                        start: s.start.unwrap_or(0.0),
                        duration: s.duration.unwrap_or(0.0),
                        loudness: s.loudness.unwrap_or(-60.0),
                        tempo: s.tempo.unwrap_or(0.0),
                    })
                    .collect(),
            }))
        }
        // 403 = endpoint deprecated for this API app; 404 = no analysis for
        // this track. Both are the documented "no grid" outcome, not errors.
        Err(ureq::Error::Status(403, _)) | Err(ureq::Error::Status(404, _)) => Ok(None),
        Err(ureq::Error::Status(401, _)) => Err(ApiErr::Unauthorized),
        Err(e) => Err(ApiErr::Other(e.to_string())),
    }
}

/// Blocking — call from spawn_blocking only. Resolves what's playing NOW.
fn fetch_now_playing<R: Runtime>(app: &AppHandle<R>) -> Result<Option<(String, u64, bool)>, ApiErr> {
    let token = ensure_fresh_token(app)?;
    let resp = ureq::get("https://api.spotify.com/v1/me/player")
        .set("Authorization", &format!("Bearer {token}"))
        .timeout(Duration::from_secs(8))
        .call();
    let r = match resp {
        Ok(r) => r,
        Err(ureq::Error::Status(401, _)) => match try_refresh(app) {
            RefreshOutcome::Refreshed => {
                let token = CREDS.lock().access_token.clone().ok_or(ApiErr::Unauthorized)?;
                ureq::get("https://api.spotify.com/v1/me/player")
                    .set("Authorization", &format!("Bearer {token}"))
                    .timeout(Duration::from_secs(8))
                    .call()
                    .map_err(|e| ApiErr::Other(e.to_string()))?
            }
            RefreshOutcome::Transient => return Err(ApiErr::Transient),
            RefreshOutcome::Revoked => return Err(ApiErr::Unauthorized),
        },
        Err(ureq::Error::Status(404, _)) => return Ok(None),
        Err(e) => return Err(ApiErr::Other(e.to_string())),
    };
    if r.status() == 204 {
        return Ok(None); // nothing playing
    }
    let now: NowResp = r.into_json().map_err(|e| ApiErr::Other(e.to_string()))?;
    let Some(item) = now.item else { return Ok(None) };
    let Some(id) = item.id.filter(|s| !s.is_empty()) else { return Ok(None) };
    Ok(Some((id, now.progress_ms.unwrap_or(0), now.is_playing.unwrap_or(false))))
}

/// The current track's beat/bar/section grid, or null when Spotify isn't
/// connected, nothing is playing, or analysis is unavailable (deprecated
/// endpoint / unknown track). Poll-friendly: the analysis body is cached per
/// track, so steady-state cost is one /me/player call per invocation.
#[tauri::command]
pub async fn spotify_sync_grid<R: Runtime>(app: AppHandle<R>) -> Option<SyncGrid> {
    tauri::async_runtime::spawn_blocking(move || {
        if !CREDS.lock().access_token.is_some() {
            return None;
        }
        let (track_id, progress_ms, playing) = fetch_now_playing(&app).ok().flatten()?;
        let cached = ANALYSIS_CACHE.lock().get(&track_id).cloned();
        let slim = match cached {
            Some(hit) => hit,
            None => {
                let token = ensure_fresh_token(&app).ok()?;
                let fetched = fetch_analysis_slim(&token, &track_id).ok()?;
                let mut cache = ANALYSIS_CACHE.lock();
                if cache.len() >= 32 {
                    cache.clear();
                }
                cache.insert(track_id.clone(), fetched.clone());
                fetched
            }
        };
        let slim = slim?;
        let fetched_at_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        Some(SyncGrid {
            track_id,
            progress_ms,
            fetched_at_ms,
            playing,
            beats: slim.beats,
            bars: slim.bars,
            sections: slim.sections,
        })
    })
    .await
    .ok()
    .flatten()
}

#[cfg(test)]
mod sync_grid_tests {
    use super::*;

    #[test]
    fn slim_events_caps_and_defaults() {
        let raw: Vec<AnEvent> = (0..5000)
            .map(|i| AnEvent { start: Some(i as f64), duration: Some(0.5), confidence: None })
            .collect();
        let slim = slim_events(Some(raw), 4000);
        assert_eq!(slim.len(), 4000);
        assert_eq!(slim[10].start, 10.0);
        assert_eq!(slim[0].confidence, 0.0);
        assert!(slim_events(None, 10).is_empty());
    }

    #[test]
    fn analysis_resp_parses_spotify_shape() {
        let json = r#"{
            "beats": [{"start": 0.5, "duration": 0.4, "confidence": 0.9}],
            "bars": [{"start": 0.5, "duration": 1.6, "confidence": 0.8}],
            "sections": [{"start": 0.0, "duration": 30.2, "loudness": -8.1, "tempo": 128.0, "key": 5}]
        }"#;
        let a: AnalysisResp = serde_json::from_str(json).unwrap();
        assert_eq!(a.beats.as_ref().unwrap().len(), 1);
        assert_eq!(a.sections.as_ref().unwrap()[0].tempo, Some(128.0));
    }
}

#[cfg(test)]
mod pick_a_song_tests {
    use super::is_track_uri;

    #[test]
    fn accepts_exactly_track_uris() {
        assert!(is_track_uri("spotify:track:4uLU6hMCjMI75M1A2tKUQC"));
        assert!(is_track_uri("spotify:track:abc123"));
    }

    #[test]
    fn rejects_everything_else() {
        // Other context kinds — playing a playlist/album is not this feature.
        assert!(!is_track_uri("spotify:playlist:37i9dQZF1DXcBWIGoYBM5M"));
        assert!(!is_track_uri("spotify:album:1ATL5GLyefJaxhQzSPVrLX"));
        assert!(!is_track_uri("spotify:artist:0OdUWJ0sBjDrqHygGUXeCF"));
        // Shape violations and injection-ish inputs.
        assert!(!is_track_uri("spotify:track:"));
        assert!(!is_track_uri("spotify:track:has space"));
        assert!(!is_track_uri("spotify:track:semi;colon"));
        assert!(!is_track_uri("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC"));
        assert!(!is_track_uri(""));
        let long = format!("spotify:track:{}", "a".repeat(65));
        assert!(!is_track_uri(&long));
    }
}
