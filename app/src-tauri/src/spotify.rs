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
        s.connected = creds.access_token.is_some();
    }
    emit_state(&app);

    let app_poll = app.clone();
    std::thread::spawn(move || poll_worker(app_poll));
}

fn poll_worker<R: Runtime>(app: AppHandle<R>) {
    let mut tick: u64 = 0;
    loop {
        let connected = STATE.lock().connected;
        if connected {
            apply_player(&app);
            // Hit /me/player/queue every other tick → 10 s effective cadence.
            if tick % 2 == 0 {
                apply_queue(&app);
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
        Err(ApiErr::Other(e)) => {
            eprintln!("spotify queue: {e}");
        }
    }
}

#[derive(Debug)]
enum ApiErr { PremiumRequired, Unauthorized, Other(String) }

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
    let token = ensure_fresh_token(app).ok_or(ApiErr::Unauthorized)?;
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
            // One more refresh attempt then bail.
            if try_refresh(app) {
                let token = CREDS.lock().access_token.clone().ok_or(ApiErr::Unauthorized)?;
                let r2 = ureq::get("https://api.spotify.com/v1/me/player/queue")
                    .set("Authorization", &format!("Bearer {token}"))
                    .timeout(Duration::from_secs(8))
                    .call().map_err(|e| ApiErr::Other(e.to_string()))?;
                let q: QueueResp = r2.into_json().map_err(|e| ApiErr::Other(e.to_string()))?;
                Ok(q.queue.unwrap_or_default().into_iter().take(20).map(map_item).collect())
            } else {
                Err(ApiErr::Unauthorized)
            }
        }
        Err(ureq::Error::Status(403, _)) => Err(ApiErr::PremiumRequired),
        Err(ureq::Error::Status(404, _)) => Ok(Vec::new()), // no active player
        Err(e) => Err(ApiErr::Other(e.to_string())),
    }
}

fn fetch_player<R: Runtime>(app: &AppHandle<R>) -> Result<Option<PlayerDevice>, ApiErr> {
    let token = ensure_fresh_token(app).ok_or(ApiErr::Unauthorized)?;
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
            if try_refresh(app) {
                let token = CREDS.lock().access_token.clone().ok_or(ApiErr::Unauthorized)?;
                let r2 = ureq::get("https://api.spotify.com/v1/me/player")
                    .set("Authorization", &format!("Bearer {token}"))
                    .timeout(Duration::from_secs(8))
                    .call().map_err(|e| ApiErr::Other(e.to_string()))?;
                if r2.status() == 204 { return Ok(None); }
                let p: PlayerResp = r2.into_json().map_err(|e| ApiErr::Other(e.to_string()))?;
                Ok(p.device)
            } else {
                Err(ApiErr::Unauthorized)
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

fn ensure_fresh_token<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    let creds = CREDS.lock().clone();
    let access = creds.access_token.clone()?;
    let expires_at = creds.expires_at.unwrap_or(0);
    if expires_at > now_secs() + 60 {
        return Some(access);
    }
    if try_refresh(app) {
        CREDS.lock().access_token.clone()
    } else {
        None
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

fn try_refresh<R: Runtime>(app: &AppHandle<R>) -> bool {
    let creds = CREDS.lock().clone();
    let Some(client_id) = creds.client_id else { return false };
    let Some(refresh_token) = creds.refresh_token else { return false };
    let body = format!(
        "grant_type=refresh_token&refresh_token={}&client_id={}",
        urlencode(&refresh_token), urlencode(&client_id),
    );
    let resp = ureq::post("https://accounts.spotify.com/api/token")
        .set("Content-Type", "application/x-www-form-urlencoded")
        .timeout(Duration::from_secs(8))
        .send_string(&body);
    let Ok(r) = resp else { return false };
    let Ok(tok): Result<TokenResp, _> = r.into_json() else { return false };
    let mut c = CREDS.lock();
    c.access_token = Some(tok.access_token);
    if let Some(rt) = tok.refresh_token { c.refresh_token = Some(rt); }
    c.expires_at = Some(now_secs() + tok.expires_in.unwrap_or(3600));
    save_creds(app, &c);
    true
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

    let token = ensure_fresh_token(&app).ok_or_else(|| "Not connected".to_string())?;
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
        if !try_refresh(&app) {
            return Err("Spotify auth expired".into());
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
