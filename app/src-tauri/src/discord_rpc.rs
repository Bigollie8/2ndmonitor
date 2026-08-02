//! Discord local IPC (RPC) client.
//!
//! Connects to `\\.\pipe\discord-ipc-0` (Discord's local Named Pipe), performs
//! the IPC handshake + AUTHENTICATE with our existing OAuth access token, then
//! subscribes to the events we care about:
//!
//!   - NOTIFICATION_CREATE  → live DM / @mention feed (whenever Discord would
//!     have shown a desktop notification, we get the same payload)
//!   - VOICE_CHANNEL_SELECT → user joined / left a voice channel
//!   - VOICE_STATE_CREATE / VOICE_STATE_UPDATE / VOICE_STATE_DELETE → who's in
//!     the call, mute/deaf state changes
//!   - SPEAKING_START / SPEAKING_STOP → speaking indicator
//!
//! The OAuth scopes `rpc rpc.notifications.read rpc.voice.read` are required.
//! As the app *owner*, the user can grant these to their own Discord
//! application without Discord-staff approval.

use crate::discord;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{channel, Sender},
        Arc,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Runtime};
#[cfg(windows)]
use std::{ffi::OsStr, os::windows::ffi::OsStrExt};
#[cfg(windows)]
use windows::core::PCWSTR;
#[cfg(windows)]
use windows::Win32::Foundation::{CloseHandle, ERROR_IO_PENDING, HANDLE};
#[cfg(windows)]
use windows::Win32::Storage::FileSystem::{
    CreateFileW, ReadFile, WriteFile, FILE_FLAG_OVERLAPPED, FILE_GENERIC_READ, FILE_GENERIC_WRITE,
    FILE_SHARE_NONE, OPEN_EXISTING,
};
#[cfg(windows)]
use windows::Win32::System::Threading::CreateEventW;
#[cfg(windows)]
use windows::Win32::System::IO::{GetOverlappedResult, OVERLAPPED};

/// Per-platform Discord IPC transport. Windows: `PipeIo`, a named-pipe wrapper
/// using overlapped I/O (see the comment above `PipeIo` for why). macOS/Linux:
/// `SocketIo`, a plain blocking Unix domain socket — no overlapped-I/O
/// equivalent needed there (see the comment above `SocketIo`).
#[cfg(windows)]
type Transport = PipeIo;
#[cfg(unix)]
type Transport = SocketIo;

/// Where Discord's IPC endpoint lives. Windows: a named pipe. macOS/Linux:
/// a Unix domain socket under the per-user temp dir (Discord also checks
/// TMPDIR/XDG_RUNTIME_DIR; TMPDIR is what the macOS client uses).
#[cfg(windows)]
fn ipc_path(index: u8) -> String { format!(r"\\.\pipe\discord-ipc-{index}") }
#[cfg(unix)]
fn ipc_path(index: u8) -> String {
    let base = std::env::var("TMPDIR").unwrap_or_else(|_| "/tmp".to_string());
    format!("{}/discord-ipc-{index}", base.trim_end_matches('/'))
}

const RECONNECT_DELAY_SECS: u64 = 5;
const MAX_NOTIFICATIONS: usize = 20;

#[derive(Debug, Clone, Serialize, Default)]
pub struct VoiceMember {
    pub user_id: String,
    pub username: String,
    pub global_name: Option<String>,
    pub avatar: Option<String>,
    pub muted: bool,
    pub deafened: bool,
    pub speaking: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct VoiceState {
    pub channel_id: Option<String>,
    pub channel_name: Option<String>,
    pub guild_id: Option<String>,
    pub guild_name: Option<String>,
    pub members: Vec<VoiceMember>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RpcNotification {
    pub timestamp_ms: u64,
    pub channel_id: String,
    pub author: String,
    pub author_avatar: Option<String>,
    pub title: String,
    pub body: String,
    pub icon_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct RpcState {
    pub connected: bool,
    pub error: Option<String>,
    pub voice: VoiceState,
    pub notifications: Vec<RpcNotification>,
    /// User-id of the authenticated Discord user (i.e. "us"). Lets the
    /// frontend find which voice member is the current user, so it can
    /// render mute/deafen toggles whose state reflects the live voice_state.
    pub self_user_id: Option<String>,
}

static STATE: Lazy<Mutex<RpcState>> = Lazy::new(|| Mutex::new(RpcState::default()));
static NONCE: AtomicU64 = AtomicU64::new(1);

/// Write-side handle to the active IPC transport. Tauri commands clone this
/// so they can send SET_VOICE_SETTINGS / SELECT_VOICE_CHANNEL etc. while the
/// worker thread reads concurrently — on Windows `PipeIo` uses overlapped I/O
/// so reads and writes don't serialize at the FILE_OBJECT level; on
/// macOS/Linux `SocketIo` just needs its internal write lock. None when no
/// session is live.
static WRITE_PIPE: Lazy<Mutex<Option<Transport>>> = Lazy::new(|| Mutex::new(None));

/// Pending command nonces awaiting a Discord IPC response. Each entry's Sender
/// resolves the matching `discord_rpc_*` Tauri command with the parsed response
/// value. Entries are removed by the read loop on response, or by the command
/// itself on timeout.
static PENDING: Lazy<Mutex<HashMap<String, Sender<Value>>>> = Lazy::new(|| Mutex::new(HashMap::new()));

fn next_nonce() -> String {
    NONCE.fetch_add(1, Ordering::Relaxed).to_string()
}

fn emit_state<R: Runtime>(app: &AppHandle<R>) {
    let s = STATE.lock().clone();
    let _ = app.emit("discord_rpc:state", &s);
}

pub fn spawn<R: Runtime>(app: AppHandle<R>) {
    thread::spawn(move || loop {
        let Some(client_id) = discord::current_client_id() else {
            // No app configured yet; wait for the user to connect via REST first.
            thread::sleep(Duration::from_secs(RECONNECT_DELAY_SECS));
            continue;
        };
        let Some(token) = discord::current_access_token() else {
            thread::sleep(Duration::from_secs(RECONNECT_DELAY_SECS));
            continue;
        };

        match run_session(&app, &client_id, &token) {
            Ok(()) => {} // session ended cleanly (loop and reconnect)
            Err(e) => {
                let mut s = STATE.lock();
                s.connected = false;
                s.error = Some(e.clone());
                drop(s);
                emit_state(&app);
                eprintln!("discord_rpc: session ended: {e}");
            }
        }
        thread::sleep(Duration::from_secs(RECONNECT_DELAY_SECS));
    });
}

fn run_session<R: Runtime>(app: &AppHandle<R>, client_id: &str, token: &str) -> Result<(), String> {
    // Verify scopes against Discord directly. AUTHENTICATE succeeds for the
    // app owner regardless of scopes, but SUBSCRIBE silently no-ops without
    // the right ones — which presents to the user as "RPC connected but no
    // voice/notifications ever fire." Catching it here lets the UI show a
    // clear "sign out and reconnect" prompt.
    let scopes = fetch_granted_scopes(token)?;
    eprintln!("discord_rpc: granted scopes from API = {:?}", scopes);
    let needed = ["rpc", "rpc.voice.read", "rpc.voice.write", "rpc.notifications.read"];
    let missing: Vec<&str> = needed
        .iter()
        .copied()
        .filter(|n| !scopes.iter().any(|s| s == *n))
        .collect();
    if !missing.is_empty() {
        return Err(format!(
            "missing RPC scopes — sign out and reconnect (missing: {})",
            missing.join(", ")
        ));
    }

    eprintln!("discord_rpc: opening pipe…");
    let pipe = open_pipe()?;
    let writer = pipe.clone();
    *WRITE_PIPE.lock() = Some(pipe.clone());
    let read_pipe = pipe;
    eprintln!("discord_rpc: pipe open, sending handshake");

    // ── HANDSHAKE ───────────────────────────────────────────────────────────
    write_frame(&writer, 0, &json!({"v": 1, "client_id": client_id}).to_string())?;
    let (_op, ready_body) = recv_frame(&read_pipe)?;
    let _ready: Value = serde_json::from_slice(&ready_body).map_err(|e| e.to_string())?;
    eprintln!("discord_rpc: ready, authenticating");

    // ── AUTHENTICATE ────────────────────────────────────────────────────────
    let auth_nonce = next_nonce();
    write_frame(
        &writer,
        1,
        &json!({
            "nonce": auth_nonce,
            "cmd": "AUTHENTICATE",
            "args": {"access_token": token}
        })
        .to_string(),
    )?;
    let (_op, auth_body) = recv_frame(&read_pipe)?;
    let auth_resp: Value =
        serde_json::from_slice(&auth_body).map_err(|e| format!("auth parse: {e}"))?;
    if auth_resp.get("evt").and_then(|v| v.as_str()) == Some("ERROR") {
        let msg = auth_resp
            .get("data")
            .and_then(|d| d.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("authentication failed")
            .to_string();
        let code = auth_resp
            .get("data")
            .and_then(|d| d.get("code"))
            .and_then(|c| c.as_i64());
        // Discord returns code 4006 / message containing "scope" when the
        // token is missing rpc scopes — surface a hint instead of the raw
        // backend error so the UI can prompt for reconnect.
        let lower = msg.to_lowercase();
        let hint = if code == Some(4006)
            || lower.contains("scope")
            || lower.contains("oauth")
        {
            format!("missing RPC scopes — sign out and reconnect ({msg})")
        } else {
            msg
        };
        return Err(format!("authenticate: {hint}"));
    }
    // Pull the authenticated user out of the AUTHENTICATE response — used by
    // the frontend to identify "us" inside the voice members list (so we know
    // whose mute/deafen state to reflect on the toggle buttons).
    let self_id = auth_resp
        .get("data")
        .and_then(|d| d.get("user"))
        .and_then(|u| u.get("id"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    if let Some(ref id) = self_id {
        STATE.lock().self_user_id = Some(id.clone());
    }
    eprintln!("discord_rpc: authenticated as {self_id:?}, subscribing");

    // ── SUBSCRIBE to events ─────────────────────────────────────────────────
    for evt in [
        "NOTIFICATION_CREATE",
        "VOICE_CHANNEL_SELECT",
        "VOICE_SETTINGS_UPDATE",
        "SPEAKING_START",
        "SPEAKING_STOP",
    ] {
        write_frame(
            &writer,
            1,
            &json!({"nonce": next_nonce(), "cmd": "SUBSCRIBE", "evt": evt}).to_string(),
        )?;
    }

    // Pull the current voice channel up front so we don't have to wait for a
    // VOICE_CHANNEL_SELECT to populate state.
    write_frame(
        &writer,
        1,
        &json!({"nonce": next_nonce(), "cmd": "GET_SELECTED_VOICE_CHANNEL"}).to_string(),
    )?;

    {
        let mut s = STATE.lock();
        s.connected = true;
        s.error = None;
    }
    emit_state(app);
    eprintln!("discord_rpc: connected, listening for events");

    // ── Read loop ───────────────────────────────────────────────────────────
    let mut current_voice_channel: Option<String> = None;
    let result: Result<(), String> = (|| loop {
        let (opcode, body) = recv_frame(&read_pipe)?;
        if opcode == 2 {
            return Err("Discord closed the IPC connection".into());
        }
        if opcode == 3 {
            // PING — respond with PONG (opcode 4) carrying the same payload.
            write_frame_raw(&writer, 4, &body)?;
            continue;
        }
        if opcode != 1 {
            continue;
        }
        let msg: Value = match serde_json::from_slice(&body) {
            Ok(v) => v,
            Err(_) => continue,
        };
        // Trace every frame so we can see what Discord is actually sending.
        // Truncate huge payloads (e.g. GET_CHANNEL with full message history).
        let cmd_dbg = msg.get("cmd").and_then(|v| v.as_str()).unwrap_or("?");
        let evt_dbg = msg.get("evt").and_then(|v| v.as_str()).unwrap_or("");
        let raw = msg.to_string();
        let preview = if raw.len() > 600 { format!("{}…(+{} bytes)", &raw[..600], raw.len() - 600) } else { raw };
        eprintln!("discord_rpc <- cmd={cmd_dbg} evt={evt_dbg} body={preview}");
        handle_message(app, &writer, &msg, &mut current_voice_channel)?;
    })();
    // Always clear the static handle when the session ends so commands can't
    // try to write to a half-dead pipe.
    *WRITE_PIPE.lock() = None;
    result
}

fn handle_message<R: Runtime>(
    app: &AppHandle<R>,
    writer: &Transport,
    msg: &Value,
    current_voice_channel: &mut Option<String>,
) -> Result<(), String> {
    // If this frame is a response to a Tauri command we sent, route it to the
    // waiting receiver and stop processing. (Both DISPATCH events and command
    // responses share the same opcode-1 frame; nonces disambiguate.)
    if let Some(nonce) = msg.get("nonce").and_then(|v| v.as_str()) {
        if let Some(tx) = PENDING.lock().remove(nonce) {
            let _ = tx.send(msg.clone());
            return Ok(());
        }
    }

    let cmd = msg.get("cmd").and_then(|v| v.as_str()).unwrap_or("");
    let evt = msg.get("evt").and_then(|v| v.as_str()).unwrap_or("");
    let data = msg.get("data");

    // GET_SELECTED_VOICE_CHANNEL response — initial fetch.
    if cmd == "GET_SELECTED_VOICE_CHANNEL" && evt != "ERROR" {
        update_voice_from_channel(app, data, current_voice_channel)?;
        return Ok(());
    }
    if cmd == "GET_CHANNEL" && evt != "ERROR" {
        update_voice_from_channel(app, data, current_voice_channel)?;
        return Ok(());
    }

    if cmd != "DISPATCH" {
        return Ok(());
    }

    match evt {
        "VOICE_CHANNEL_SELECT" => {
            // Payload: {channel_id: ..., guild_id: ...}. channel_id is null
            // when the user leaves the call.
            let channel_id = data
                .and_then(|d| d.get("channel_id"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            // Unsubscribe from the previous channel's voice-state events.
            if let Some(prev) = current_voice_channel.take() {
                let _ = write_frame(
                    writer, 1,
                    &json!({
                        "nonce": next_nonce(), "cmd": "UNSUBSCRIBE",
                        "evt": "VOICE_STATE_CREATE", "args": {"channel_id": &prev}
                    }).to_string(),
                );
                let _ = write_frame(
                    writer, 1,
                    &json!({
                        "nonce": next_nonce(), "cmd": "UNSUBSCRIBE",
                        "evt": "VOICE_STATE_UPDATE", "args": {"channel_id": &prev}
                    }).to_string(),
                );
                let _ = write_frame(
                    writer, 1,
                    &json!({
                        "nonce": next_nonce(), "cmd": "UNSUBSCRIBE",
                        "evt": "VOICE_STATE_DELETE", "args": {"channel_id": &prev}
                    }).to_string(),
                );
            }

            if let Some(cid) = channel_id.clone() {
                *current_voice_channel = Some(cid.clone());
                // Subscribe per-channel voice-state events.
                for evt in ["VOICE_STATE_CREATE", "VOICE_STATE_UPDATE", "VOICE_STATE_DELETE"] {
                    write_frame(
                        writer, 1,
                        &json!({
                            "nonce": next_nonce(), "cmd": "SUBSCRIBE",
                            "evt": evt, "args": {"channel_id": &cid}
                        }).to_string(),
                    )?;
                }
                // Pull the channel info so we have member list + names right away.
                write_frame(
                    writer, 1,
                    &json!({
                        "nonce": next_nonce(), "cmd": "GET_CHANNEL",
                        "args": {"channel_id": cid}
                    }).to_string(),
                )?;
            } else {
                // Left voice — clear state.
                {
                    let mut s = STATE.lock();
                    s.voice = VoiceState::default();
                }
                emit_state(app);
            }
        }
        "VOICE_STATE_CREATE" | "VOICE_STATE_UPDATE" => {
            if let Some(d) = data {
                let member = parse_voice_member(d);
                if let Some(m) = member {
                    let mut s = STATE.lock();
                    if let Some(existing) = s.voice.members.iter_mut().find(|x| x.user_id == m.user_id) {
                        // Preserve speaking flag — VOICE_STATE_UPDATE doesn't
                        // include it; only SPEAKING_START/STOP flip it.
                        let was_speaking = existing.speaking;
                        *existing = m;
                        existing.speaking = was_speaking;
                    } else {
                        s.voice.members.push(m);
                    }
                }
            }
            emit_state(app);
        }
        "VOICE_STATE_DELETE" => {
            if let Some(d) = data {
                if let Some(uid) = d.get("user").and_then(|u| u.get("id")).and_then(|v| v.as_str()) {
                    let mut s = STATE.lock();
                    s.voice.members.retain(|m| m.user_id != uid);
                }
            }
            emit_state(app);
        }
        "SPEAKING_START" | "SPEAKING_STOP" => {
            if let Some(uid) = data
                .and_then(|d| d.get("user_id"))
                .and_then(|v| v.as_str())
            {
                let speaking = evt == "SPEAKING_START";
                let mut s = STATE.lock();
                if let Some(m) = s.voice.members.iter_mut().find(|x| x.user_id == uid) {
                    m.speaking = speaking;
                }
            }
            emit_state(app);
        }
        "VOICE_SETTINGS_UPDATE" => {
            // Self mute/deaf toggle in Discord (or via our SET_VOICE_SETTINGS).
            // Update our own member entry so the toggle buttons reflect reality.
            let self_id = STATE.lock().self_user_id.clone();
            if let (Some(d), Some(uid)) = (data, self_id) {
                let muted = d.get("mute").and_then(|v| v.as_bool()).unwrap_or(false);
                let deafened = d.get("deaf").and_then(|v| v.as_bool()).unwrap_or(false);
                let mut s = STATE.lock();
                if let Some(m) = s.voice.members.iter_mut().find(|x| x.user_id == uid) {
                    m.muted = muted;
                    m.deafened = deafened;
                }
                drop(s);
                emit_state(app);
            }
        }
        "NOTIFICATION_CREATE" => {
            if let Some(d) = data {
                if let Some(n) = parse_notification(d) {
                    let mut s = STATE.lock();
                    s.notifications.insert(0, n);
                    if s.notifications.len() > MAX_NOTIFICATIONS {
                        s.notifications.truncate(MAX_NOTIFICATIONS);
                    }
                    drop(s);
                    emit_state(app);
                }
            }
        }
        _ => {}
    }
    Ok(())
}

fn update_voice_from_channel<R: Runtime>(
    app: &AppHandle<R>,
    data: Option<&Value>,
    current_voice_channel: &mut Option<String>,
) -> Result<(), String> {
    let Some(d) = data else { return Ok(()) };
    if d.is_null() {
        // Not currently in a voice channel.
        let mut s = STATE.lock();
        s.voice = VoiceState::default();
        drop(s);
        emit_state(app);
        return Ok(());
    }

    let channel_id = d.get("id").and_then(|v| v.as_str()).map(|s| s.to_string());
    let channel_name = d.get("name").and_then(|v| v.as_str()).map(|s| s.to_string());
    let guild_id = d.get("guild_id").and_then(|v| v.as_str()).map(|s| s.to_string());
    let voice_states = d.get("voice_states").and_then(|v| v.as_array()).cloned().unwrap_or_default();

    let members: Vec<VoiceMember> = voice_states
        .iter()
        .filter_map(parse_voice_member)
        .collect();

    if let Some(cid) = channel_id.clone() {
        *current_voice_channel = Some(cid);
    }

    {
        let mut s = STATE.lock();
        s.voice = VoiceState {
            channel_id,
            channel_name,
            guild_id,
            guild_name: None, // GET_CHANNEL doesn't return guild name; would need GET_GUILD
            members,
        };
    }
    emit_state(app);
    Ok(())
}

fn parse_voice_member(v: &Value) -> Option<VoiceMember> {
    let user = v.get("user")?;
    let user_id = user.get("id").and_then(|x| x.as_str())?.to_string();
    let username = user.get("username").and_then(|x| x.as_str()).unwrap_or("").to_string();
    let global_name = user.get("global_name").and_then(|x| x.as_str()).map(|s| s.to_string());
    let avatar = user.get("avatar").and_then(|x| x.as_str()).map(|s| s.to_string());
    let voice = v.get("voice_state");
    let muted = voice.and_then(|vs| vs.get("self_mute")).and_then(|x| x.as_bool()).unwrap_or(false)
        || voice.and_then(|vs| vs.get("mute")).and_then(|x| x.as_bool()).unwrap_or(false);
    let deafened = voice.and_then(|vs| vs.get("self_deaf")).and_then(|x| x.as_bool()).unwrap_or(false)
        || voice.and_then(|vs| vs.get("deaf")).and_then(|x| x.as_bool()).unwrap_or(false);
    Some(VoiceMember {
        user_id,
        username,
        global_name,
        avatar,
        muted,
        deafened,
        speaking: false,
    })
}

fn parse_notification(d: &Value) -> Option<RpcNotification> {
    let channel_id = d.get("channel_id").and_then(|v| v.as_str())?.to_string();
    let title = d.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let body = d.get("body").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let icon_url = d.get("icon_url").and_then(|v| v.as_str()).map(|s| s.to_string());
    let msg = d.get("message");
    let author_node = msg.and_then(|m| m.get("author"));
    let author = author_node
        .and_then(|a| a.get("global_name").and_then(|v| v.as_str()).map(|s| s.to_string())
            .or_else(|| a.get("username").and_then(|v| v.as_str()).map(|s| s.to_string())))
        .unwrap_or_default();
    let author_avatar = author_node
        .and_then(|a| a.get("avatar").and_then(|v| v.as_str()).map(|s| s.to_string()));
    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Some(RpcNotification {
        timestamp_ms,
        channel_id,
        author,
        author_avatar,
        title,
        body,
        icon_url,
    })
}

/// Hit `/oauth2/@me` to read the live list of scopes Discord granted us.
/// More reliable than the cached value in `granted_scopes` because it works
/// even for tokens minted by an older code path that didn't persist scopes.
fn fetch_granted_scopes(token: &str) -> Result<Vec<String>, String> {
    let resp: serde_json::Value = ureq::get("https://discord.com/api/oauth2/@me")
        .set("Authorization", &format!("Bearer {token}"))
        .call()
        .map_err(|e| format!("oauth2/@me: {e}"))?
        .into_json()
        .map_err(|e| format!("oauth2/@me parse: {e}"))?;
    Ok(resp
        .get("scopes")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|s| s.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default())
}

fn open_pipe() -> Result<Transport, String> {
    // Discord may use 0..9 if multiple instances are running. Try in order.
    let mut last_err = String::new();
    for i in 0..=9u8 {
        let path = ipc_path(i);
        match Transport::open(&path) {
            Ok(p) => return Ok(p),
            Err(e) => last_err = format!("{path}: {e}"),
        }
    }
    Err(format!("no Discord IPC pipe available (is Discord running?) — {last_err}"))
}

/// Build the full IPC frame as one buffer so we can write it atomically — if
/// reads (on the worker thread) and writes (from Tauri commands) interleaved
/// at the byte level, Discord would see corrupted frames.
fn frame_bytes(opcode: u32, payload: &[u8]) -> Vec<u8> {
    let mut buf = Vec::with_capacity(8 + payload.len());
    buf.extend_from_slice(&opcode.to_le_bytes());
    buf.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    buf.extend_from_slice(payload);
    buf
}

fn write_frame(writer: &Transport, opcode: u32, json_payload: &str) -> Result<(), String> {
    write_frame_raw(writer, opcode, json_payload.as_bytes())
}

fn write_frame_raw(writer: &Transport, opcode: u32, payload: &[u8]) -> Result<(), String> {
    let bytes = frame_bytes(opcode, payload);
    writer.write_all(&bytes)?;
    Ok(())
}

fn recv_frame(pipe: &Transport) -> Result<(u32, Vec<u8>), String> {
    let mut header = [0u8; 8];
    pipe.read_exact(&mut header)?;
    let opcode = u32::from_le_bytes([header[0], header[1], header[2], header[3]]);
    let len = u32::from_le_bytes([header[4], header[5], header[6], header[7]]) as usize;
    if len > 1_000_000 {
        return Err(format!("frame too large: {len}"));
    }
    let mut body = vec![0u8; len];
    if len > 0 {
        pipe.read_exact(&mut body)?;
    }
    Ok((opcode, body))
}

// ── Win32 overlapped-I/O pipe wrapper ────────────────────────────────────────
//
// Discord's IPC pipe is a duplex named pipe. Naively opening it with synchronous
// I/O serializes reads and writes at the FILE_OBJECT level — even with
// duplicated handles — so a write from a Tauri command (e.g. SET_VOICE_SETTINGS)
// blocks for tens of seconds until the worker's pending ReadFile completes
// (which only happens when Discord pushes an event). That's why mute/deafen
// "didn't work until a Discord message arrived." Opening with FILE_FLAG_OVERLAPPED
// lets read and write proceed independently.

#[cfg(windows)]
struct PipeHandle(HANDLE);
#[cfg(windows)]
unsafe impl Send for PipeHandle {}
#[cfg(windows)]
unsafe impl Sync for PipeHandle {}
#[cfg(windows)]
impl Drop for PipeHandle {
    fn drop(&mut self) {
        if !self.0.is_invalid() {
            unsafe { let _ = CloseHandle(self.0); }
        }
    }
}

#[cfg(windows)]
#[derive(Clone)]
pub struct PipeIo {
    handle: Arc<PipeHandle>,
    /// Serializes concurrent WriteFile calls so frames don't interleave.
    write_lock: Arc<Mutex<()>>,
}

#[cfg(windows)]
impl PipeIo {
    fn open(path: &str) -> Result<Self, String> {
        let wide: Vec<u16> = OsStr::new(path).encode_wide().chain(std::iter::once(0)).collect();
        let handle = unsafe {
            CreateFileW(
                PCWSTR(wide.as_ptr()),
                FILE_GENERIC_READ.0 | FILE_GENERIC_WRITE.0,
                FILE_SHARE_NONE,
                None,
                OPEN_EXISTING,
                FILE_FLAG_OVERLAPPED,
                None,
            )
        }
        .map_err(|e| format!("CreateFileW: {e}"))?;
        Ok(Self {
            handle: Arc::new(PipeHandle(handle)),
            write_lock: Arc::new(Mutex::new(())),
        })
    }

    fn raw(&self) -> HANDLE {
        self.handle.0
    }

    /// Read exactly `buf.len()` bytes, blocking the calling thread until they
    /// arrive. Uses overlapped I/O so a parallel WriteFile on the same handle
    /// is not blocked by us.
    fn read_exact(&self, buf: &mut [u8]) -> Result<(), String> {
        let event = unsafe { CreateEventW(None, true, false, PCWSTR::null()) }
            .map_err(|e| format!("CreateEventW (read): {e}"))?;
        let _guard = EventGuard(event);
        let mut total = 0usize;
        while total < buf.len() {
            let mut overlapped = OVERLAPPED::default();
            overlapped.hEvent = event;
            let chunk = &mut buf[total..];
            let mut got: u32 = 0;
            let result = unsafe {
                ReadFile(
                    self.raw(),
                    Some(chunk),
                    Some(&mut got as *mut u32),
                    Some(&mut overlapped as *mut OVERLAPPED),
                )
            };
            if let Err(e) = result {
                if e.code() != ERROR_IO_PENDING.to_hresult() {
                    return Err(format!("ReadFile: {e}"));
                }
                let mut transferred: u32 = 0;
                unsafe {
                    GetOverlappedResult(
                        self.raw(),
                        &overlapped as *const OVERLAPPED,
                        &mut transferred as *mut u32,
                        true,
                    )
                }
                .map_err(|e| format!("GetOverlappedResult (read): {e}"))?;
                got = transferred;
            }
            if got == 0 {
                return Err("pipe closed (EOF on read)".into());
            }
            total += got as usize;
        }
        Ok(())
    }

    /// Write all bytes, blocking the calling thread until WriteFile has
    /// completed. Serialized via `write_lock` so concurrent writers can't
    /// interleave their frames.
    fn write_all(&self, data: &[u8]) -> Result<(), String> {
        let _g = self.write_lock.lock();
        let event = unsafe { CreateEventW(None, true, false, PCWSTR::null()) }
            .map_err(|e| format!("CreateEventW (write): {e}"))?;
        let _guard = EventGuard(event);
        let mut total = 0usize;
        while total < data.len() {
            let mut overlapped = OVERLAPPED::default();
            overlapped.hEvent = event;
            let chunk = &data[total..];
            let mut written: u32 = 0;
            let result = unsafe {
                WriteFile(
                    self.raw(),
                    Some(chunk),
                    Some(&mut written as *mut u32),
                    Some(&mut overlapped as *mut OVERLAPPED),
                )
            };
            if let Err(e) = result {
                if e.code() != ERROR_IO_PENDING.to_hresult() {
                    return Err(format!("WriteFile: {e}"));
                }
                let mut transferred: u32 = 0;
                unsafe {
                    GetOverlappedResult(
                        self.raw(),
                        &overlapped as *const OVERLAPPED,
                        &mut transferred as *mut u32,
                        true,
                    )
                }
                .map_err(|e| format!("GetOverlappedResult (write): {e}"))?;
                written = transferred;
            }
            if written == 0 {
                return Err("WriteFile returned 0 bytes".into());
            }
            total += written as usize;
        }
        Ok(())
    }
}

#[cfg(windows)]
struct EventGuard(HANDLE);
#[cfg(windows)]
impl Drop for EventGuard {
    fn drop(&mut self) {
        if !self.0.is_invalid() {
            unsafe { let _ = CloseHandle(self.0); }
        }
    }
}

// ── Unix domain socket transport (macOS/Linux) ───────────────────────────────
//
// The Windows overlapped-I/O dance above exists solely because a pending
// ReadFile blocks a concurrent WriteFile on the same named-pipe handle. Unix
// domain sockets have no such restriction — a thread blocked in recv() on one
// end doesn't stop another thread from send()-ing on the same fd — so the
// plain blocking implementation below is correct as-is. Do not "port" the
// overlapped-I/O complexity here; it would be solving a problem this
// transport doesn't have.
#[cfg(unix)]
#[derive(Clone)]
pub struct SocketIo {
    stream: Arc<parking_lot::Mutex<std::os::unix::net::UnixStream>>,
    /// Serializes concurrent writes so frames don't interleave, matching
    /// `PipeIo`'s write_lock.
    write_lock: Arc<parking_lot::Mutex<()>>,
}

#[cfg(unix)]
impl SocketIo {
    fn open(path: &str) -> Result<Self, String> {
        let stream = std::os::unix::net::UnixStream::connect(path)
            .map_err(|e| format!("connect {path}: {e}"))?;
        Ok(Self {
            stream: Arc::new(parking_lot::Mutex::new(stream)),
            write_lock: Arc::new(parking_lot::Mutex::new(())),
        })
    }

    fn read_exact(&self, buf: &mut [u8]) -> Result<(), String> {
        use std::io::Read;
        self.stream.lock().read_exact(buf).map_err(|e| format!("read: {e}"))
    }

    fn write_all(&self, data: &[u8]) -> Result<(), String> {
        use std::io::Write;
        let _guard = self.write_lock.lock();
        let mut s = self.stream.lock();
        s.write_all(data).map_err(|e| format!("write: {e}"))?;
        s.flush().map_err(|e| format!("flush: {e}"))
    }
}

#[tauri::command]
pub async fn discord_rpc_status() -> RpcState {
    STATE.lock().clone()
}

/// Convert a Discord IPC response frame into a Tauri command Result.
/// Discord returns `evt: "ERROR"` with a `data.message` for failures.
fn parse_command_response(resp: &Value) -> Result<(), String> {
    if resp.get("evt").and_then(|v| v.as_str()) == Some("ERROR") {
        let msg = resp
            .get("data")
            .and_then(|d| d.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("Discord returned ERROR")
            .to_string();
        return Err(msg);
    }
    Ok(())
}

fn writer_or_err() -> Result<Transport, String> {
    WRITE_PIPE
        .lock()
        .clone()
        .ok_or_else(|| "RPC not connected — voice features unavailable".to_string())
}

/// Toggle the user's own mute / deafen via SET_VOICE_SETTINGS.
/// Either field may be omitted; the other passes through unchanged.
#[tauri::command]
pub async fn discord_rpc_set_voice_settings(mute: Option<bool>, deaf: Option<bool>) -> Result<(), String> {
    let writer = writer_or_err()?;
    let mut args = serde_json::Map::new();
    if let Some(m) = mute {
        args.insert("mute".into(), Value::Bool(m));
    }
    if let Some(d) = deaf {
        args.insert("deaf".into(), Value::Bool(d));
    }
    if args.is_empty() {
        return Err("no fields to update".into());
    }

    let nonce = next_nonce();
    let (tx, rx) = channel();
    PENDING.lock().insert(nonce.clone(), tx);

    let payload = json!({
        "nonce": nonce,
        "cmd": "SET_VOICE_SETTINGS",
        "args": args,
    });
    if let Err(e) = write_frame(&writer, 1, &payload.to_string()) {
        PENDING.lock().remove(&nonce);
        return Err(e);
    }

    match rx.recv_timeout(Duration::from_millis(2000)) {
        Ok(resp) => parse_command_response(&resp),
        Err(_) => {
            PENDING.lock().remove(&nonce);
            Err("Discord did not respond within 2s".into())
        }
    }
}

/// Read current self-mute/self-deaf state from Discord. Backs the Stream Deck
/// "toggle mute"/"toggle deafen" actions — the front-end reads this, then
/// calls `discord_rpc_set_voice_settings` with the inverted bit.
#[derive(serde::Serialize)]
pub struct VoiceSettings {
    pub mute: bool,
    pub deaf: bool,
}

#[tauri::command]
pub async fn discord_rpc_get_voice_settings() -> Result<VoiceSettings, String> {
    let writer = writer_or_err()?;
    let nonce = next_nonce();
    let (tx, rx) = channel();
    PENDING.lock().insert(nonce.clone(), tx);

    let payload = json!({
        "nonce": nonce,
        "cmd": "GET_VOICE_SETTINGS",
        "args": {},
    });
    if let Err(e) = write_frame(&writer, 1, &payload.to_string()) {
        PENDING.lock().remove(&nonce);
        return Err(e);
    }

    let resp = rx
        .recv_timeout(Duration::from_millis(2000))
        .map_err(|_| {
            PENDING.lock().remove(&nonce);
            "Discord did not respond within 2s".to_string()
        })?;
    parse_command_response(&resp)?;

    let data = resp.get("data").ok_or_else(|| "missing data field".to_string())?;
    let mute = data.get("mute").and_then(|v| v.as_bool()).unwrap_or(false);
    let deaf = data.get("deaf").and_then(|v| v.as_bool()).unwrap_or(false);
    Ok(VoiceSettings { mute, deaf })
}

/// Disconnect from the current voice channel (Discord's "leave call" action).
#[tauri::command]
pub async fn discord_rpc_leave_voice() -> Result<(), String> {
    let writer = writer_or_err()?;
    let nonce = next_nonce();
    let (tx, rx) = channel();
    PENDING.lock().insert(nonce.clone(), tx);

    let payload = json!({
        "nonce": nonce,
        "cmd": "SELECT_VOICE_CHANNEL",
        "args": { "channel_id": Value::Null },
    });
    if let Err(e) = write_frame(&writer, 1, &payload.to_string()) {
        PENDING.lock().remove(&nonce);
        return Err(e);
    }

    match rx.recv_timeout(Duration::from_millis(2000)) {
        Ok(resp) => parse_command_response(&resp),
        Err(_) => {
            PENDING.lock().remove(&nonce);
            Err("Discord did not respond within 2s".into())
        }
    }
}
