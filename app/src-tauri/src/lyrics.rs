//! Time-synced lyrics via LRCLIB (free, no auth, no API key).
//!
//! Driven by track-change signals from `nowplaying.rs` over a `mpsc::channel`.
//! On change we hit `https://lrclib.net/api/get` and emit `lyrics:update` (or
//! `lyrics:clear` on 404). A small LRU cache makes seek-back instant.

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::mpsc::{Receiver, Sender, channel};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Runtime};

const CACHE_CAP: usize = 50;
const HTTP_TIMEOUT_SECS: u64 = 8;

#[derive(Debug, Clone, Serialize)]
pub struct LyricsPayload {
    pub track_key: String,
    pub synced_lrc: Option<String>,
    pub plain_lyrics: Option<String>,
    pub instrumental: bool,
}

#[derive(Debug, Clone)]
pub struct TrackInfo {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_secs: f64,
}

#[derive(Deserialize)]
struct LrcResp {
    #[serde(rename = "syncedLyrics")] synced_lyrics: Option<String>,
    #[serde(rename = "plainLyrics")]  plain_lyrics: Option<String>,
    #[serde(default)] instrumental: bool,
}

/// Channel sender exposed to nowplaying.rs. Set once at boot.
static SENDER: Mutex<Option<Sender<TrackInfo>>> = Mutex::new(None);

pub fn track_sender() -> Option<Sender<TrackInfo>> {
    SENDER.lock().clone()
}

pub fn spawn<R: Runtime>(app: AppHandle<R>) {
    let (tx, rx) = channel::<TrackInfo>();
    *SENDER.lock() = Some(tx);
    std::thread::spawn(move || worker(app, rx));
}

fn track_key(t: &TrackInfo) -> String {
    format!("{}|{}|{}", t.artist.trim(), t.title.trim(), t.album.trim())
}

fn worker<R: Runtime>(app: AppHandle<R>, rx: Receiver<TrackInfo>) {
    let cache: Mutex<VecDeque<(String, LyricsPayload)>> = Mutex::new(VecDeque::with_capacity(CACHE_CAP));
    let mut last_key: Option<String> = None;

    while let Ok(track) = rx.recv() {
        if track.title.is_empty() {
            // Empty track => clear lyrics.
            last_key = None;
            let _ = app.emit("lyrics:clear", ());
            continue;
        }
        let key = track_key(&track);
        if last_key.as_deref() == Some(key.as_str()) {
            continue; // dedup
        }

        // Drain any further pending changes that arrived while we were busy —
        // only keep the latest. Fast track-skipping shouldn't waste fetches.
        let mut latest = track;
        while let Ok(next) = rx.try_recv() {
            latest = next;
        }
        let key = track_key(&latest);
        last_key = Some(key.clone());

        // Cache hit?
        if let Some(hit) = cache.lock().iter().find(|(k, _)| *k == key).cloned() {
            let _ = app.emit("lyrics:update", &hit.1);
            continue;
        }

        match fetch(&latest) {
            Ok(payload) => {
                {
                    let mut c = cache.lock();
                    c.push_back((key.clone(), payload.clone()));
                    if c.len() > CACHE_CAP { c.pop_front(); }
                }
                let _ = app.emit("lyrics:update", &payload);
            }
            Err(NotFound) => {
                let payload = LyricsPayload {
                    track_key: key.clone(),
                    synced_lrc: None,
                    plain_lyrics: None,
                    instrumental: false,
                };
                {
                    let mut c = cache.lock();
                    c.push_back((key.clone(), payload.clone()));
                    if c.len() > CACHE_CAP { c.pop_front(); }
                }
                let _ = app.emit("lyrics:clear", &payload);
            }
            Err(other) => {
                eprintln!("lyrics: fetch failed: {other:?}");
                // Don't cache transient failures; user may get a retry on next track change.
            }
        }
    }
}

#[derive(Debug)]
#[allow(dead_code)] // Http variant payload is read via Debug in eprintln! only.
enum FetchErr { NotFound, Http(String) }
use FetchErr::NotFound;

fn fetch(t: &TrackInfo) -> Result<LyricsPayload, FetchErr> {
    eprintln!("lyrics: fetching '{}' / '{}' (album '{}', dur {:.0}s)",
        t.title, t.artist, t.album, t.duration_secs);

    // Strategy 1: strict /api/get with all four fields (requires duration match
    // within ~2 seconds). When LRCLIB has the track and our metadata is clean
    // this is fastest and gives the best-quality match.
    if t.duration_secs > 0.0 && !t.album.is_empty() {
        if let Some(payload) = try_get(t, true) {
            eprintln!("lyrics:   ✓ /api/get hit (synced={})", payload.synced_lrc.is_some());
            return Ok(payload);
        }
    }
    // Strategy 2: drop album (Spotify GSMTC sometimes reports the SINGLE name
    // instead of the ALBUM name, which kills /get).
    if t.duration_secs > 0.0 {
        if let Some(payload) = try_get(t, false) {
            eprintln!("lyrics:   ✓ /api/get hit without album");
            return Ok(payload);
        }
    }
    // Strategy 3: fuzzy /api/search by track + artist. Pick the first hit.
    match try_search(t) {
        Some(payload) => {
            eprintln!("lyrics:   ✓ /api/search hit (synced={})", payload.synced_lrc.is_some());
            Ok(payload)
        }
        None => {
            eprintln!("lyrics:   ✗ no match");
            Err(NotFound)
        }
    }
}

fn try_get(t: &TrackInfo, with_album: bool) -> Option<LyricsPayload> {
    let url = if with_album {
        format!(
            "https://lrclib.net/api/get?track_name={}&artist_name={}&album_name={}&duration={}",
            urlencode(&t.title), urlencode(&t.artist), urlencode(&t.album),
            t.duration_secs.round() as i64,
        )
    } else {
        format!(
            "https://lrclib.net/api/get?track_name={}&artist_name={}&duration={}",
            urlencode(&t.title), urlencode(&t.artist),
            t.duration_secs.round() as i64,
        )
    };
    let resp = ureq::get(&url).timeout(Duration::from_secs(HTTP_TIMEOUT_SECS)).call();
    match resp {
        Ok(r) => r.into_json::<LrcResp>().ok().map(|p| LyricsPayload {
            track_key: track_key(t),
            synced_lrc: p.synced_lyrics,
            plain_lyrics: p.plain_lyrics,
            instrumental: p.instrumental,
        }),
        Err(_) => None,
    }
}

fn try_search(t: &TrackInfo) -> Option<LyricsPayload> {
    let url = format!(
        "https://lrclib.net/api/search?track_name={}&artist_name={}",
        urlencode(&t.title), urlencode(&t.artist),
    );
    let resp = ureq::get(&url).timeout(Duration::from_secs(HTTP_TIMEOUT_SECS)).call().ok()?;
    let arr: Vec<LrcResp> = resp.into_json().ok()?;
    let first = arr.into_iter().next()?;
    Some(LyricsPayload {
        track_key: track_key(t),
        synced_lrc: first.synced_lyrics,
        plain_lyrics: first.plain_lyrics,
        instrumental: first.instrumental,
    })
}

/// Minimal URL-encoder for query string values.
fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.as_bytes() {
        let c = *b;
        let safe = (c as char).is_ascii_alphanumeric()
            || c == b'-' || c == b'_' || c == b'.' || c == b'~';
        if safe { out.push(c as char); }
        else { out.push_str(&format!("%{:02X}", c)); }
    }
    out
}
