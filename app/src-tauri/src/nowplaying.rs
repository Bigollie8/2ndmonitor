//! Now-playing track via Windows Global System Media Transport Controls (GSMTC).
//!
//! GSMTC reports the active media session for *any* app on Windows — Spotify,
//! Apple Music, browser audio, anything that registers with the SMTC API.
//! This sidesteps Spotify OAuth entirely while delivering richer "what's
//! playing" coverage than a single-app integration would.
//!
//! On top of metadata, we:
//!   - extract the album-art thumbnail (only when the track changes)
//!   - expose play/pause/skip commands that drive the same session
//!
//! Timeline note: GSMTC's `Position` is "where the player was at last update",
//! not "now". The frontend interpolates locally between polls when playing.

use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
pub struct NowPlaying {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub has_session: bool,
    pub playing: bool,
    pub position: f64,
    pub duration: f64,
    /// Data-URL of the thumbnail. Only included when the (title, artist, album)
    /// changes — frontend keeps the previous one across position-only updates.
    pub art_data_url: Option<String>,
}

#[cfg(windows)]
mod windows_impl {
    use super::NowPlaying;
    use base64::Engine;
    use parking_lot::Mutex;
    use std::sync::OnceLock;
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession,
        GlobalSystemMediaTransportControlsSessionManager,
        GlobalSystemMediaTransportControlsSessionMediaProperties,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    use windows::Storage::Streams::{DataReader, IRandomAccessStreamReference};

    static LAST_KEY: OnceLock<Mutex<String>> = OnceLock::new();
    fn last_key_lock() -> &'static Mutex<String> {
        LAST_KEY.get_or_init(|| Mutex::new(String::new()))
    }

    pub fn current_session() -> Option<GlobalSystemMediaTransportControlsSession> {
        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .ok()?
            .get()
            .ok()?;
        manager.GetCurrentSession().ok()
    }

    pub fn poll() -> NowPlaying {
        try_poll().unwrap_or_default()
    }

    fn try_poll() -> windows::core::Result<NowPlaying> {
        let Some(session) = current_session() else {
            return Ok(NowPlaying::default());
        };
        let props = session.TryGetMediaPropertiesAsync()?.get()?;
        let timeline = session.GetTimelineProperties().ok();
        let playback = session.GetPlaybackInfo().ok();

        let title = props.Title().map(|s| s.to_string()).unwrap_or_default();
        let artist = props.Artist().map(|s| s.to_string()).unwrap_or_default();
        let album = props.AlbumTitle().map(|s| s.to_string()).unwrap_or_default();
        let track_key = format!("{title}\0{artist}\0{album}");

        // Only re-extract album art when the track changes — the bytes are
        // big and we'd otherwise be base64-encoding ~200KB on every poll.
        let mut last = last_key_lock().lock();
        let art = if *last != track_key {
            *last = track_key.clone();
            extract_thumbnail(&props)
        } else {
            None
        };
        drop(last);

        let (position, duration) = match timeline {
            Some(t) => {
                let pos = t.Position().map(|ts| ts.Duration as f64 / 10_000_000.0).unwrap_or(0.0);
                let end = t.EndTime().map(|ts| ts.Duration as f64 / 10_000_000.0).unwrap_or(0.0);
                (pos.max(0.0), end.max(0.0))
            }
            None => (0.0, 0.0),
        };

        let playing = playback
            .and_then(|p| p.PlaybackStatus().ok())
            .map(|s| s == Status::Playing)
            .unwrap_or(false);

        Ok(NowPlaying {
            title,
            artist,
            album,
            has_session: true,
            playing,
            position,
            duration,
            art_data_url: art,
        })
    }

    fn extract_thumbnail(
        props: &GlobalSystemMediaTransportControlsSessionMediaProperties,
    ) -> Option<String> {
        let thumb_ref: IRandomAccessStreamReference = props.Thumbnail().ok()?;
        let stream = thumb_ref.OpenReadAsync().ok()?.get().ok()?;
        let size_u64 = stream.Size().ok()?;
        if size_u64 == 0 || size_u64 > 5_000_000 {
            return None;
        }
        let size = size_u64 as u32;
        let reader = DataReader::CreateDataReader(&stream).ok()?;
        reader.LoadAsync(size).ok()?.get().ok()?;
        let mut buffer = vec![0u8; size as usize];
        reader.ReadBytes(&mut buffer).ok()?;

        let mime = if buffer.starts_with(b"\xFF\xD8\xFF") {
            "image/jpeg"
        } else if buffer.starts_with(b"\x89PNG\r\n\x1a\n") {
            "image/png"
        } else if buffer.starts_with(b"GIF8") {
            "image/gif"
        } else {
            "image/jpeg"
        };
        let b64 = base64::engine::general_purpose::STANDARD.encode(&buffer);
        Some(format!("data:{};base64,{}", mime, b64))
    }

    pub fn toggle_play_pause() -> Result<(), String> {
        let s = current_session().ok_or("no session")?;
        s.TryTogglePlayPauseAsync()
            .map_err(|e| e.to_string())?
            .get()
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn next() -> Result<(), String> {
        let s = current_session().ok_or("no session")?;
        s.TrySkipNextAsync()
            .map_err(|e| e.to_string())?
            .get()
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn previous() -> Result<(), String> {
        let s = current_session().ok_or("no session")?;
        s.TrySkipPreviousAsync()
            .map_err(|e| e.to_string())?
            .get()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(not(windows))]
mod windows_impl {
    use super::NowPlaying;
    pub fn poll() -> NowPlaying { NowPlaying::default() }
    pub fn toggle_play_pause() -> Result<(), String> { Err("Windows-only".into()) }
    pub fn next() -> Result<(), String> { Err("Windows-only".into()) }
    pub fn previous() -> Result<(), String> { Err("Windows-only".into()) }
}

// Cache for the last extracted art so position-only updates don't lose it.
static LAST_ART: once_cell::sync::Lazy<Mutex<Option<String>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(None));

pub fn spawn<R: Runtime>(app: AppHandle<R>) {
    std::thread::spawn(move || {
        let mut last_track_key: Option<String> = None;
        loop {
            let mut np = windows_impl::poll();
            // Re-attach the cached art if this poll didn't re-extract.
            let mut cached = LAST_ART.lock();
            if let Some(new_art) = np.art_data_url.as_ref() {
                *cached = Some(new_art.clone());
            } else if np.has_session {
                np.art_data_url = cached.clone();
            }
            drop(cached);

            // Track-change signal for the lyrics worker.
            if np.has_session {
                let key = format!("{}\0{}\0{}", np.artist, np.title, np.album);
                if last_track_key.as_deref() != Some(key.as_str()) {
                    last_track_key = Some(key);
                    if let Some(tx) = crate::lyrics::track_sender() {
                        let _ = tx.send(crate::lyrics::TrackInfo {
                            title: np.title.clone(),
                            artist: np.artist.clone(),
                            album: np.album.clone(),
                            duration_secs: np.duration,
                        });
                    }
                }
            } else if last_track_key.is_some() {
                last_track_key = None;
                if let Some(tx) = crate::lyrics::track_sender() {
                    let _ = tx.send(crate::lyrics::TrackInfo {
                        title: String::new(), artist: String::new(),
                        album: String::new(), duration_secs: 0.0,
                    });
                }
            }

            let _ = app.emit("nowplaying:tick", &np);
            std::thread::sleep(std::time::Duration::from_secs(2));
        }
    });
}

#[tauri::command]
pub async fn media_toggle() -> Result<(), String> {
    windows_impl::toggle_play_pause()
}

#[tauri::command]
pub async fn media_next() -> Result<(), String> {
    windows_impl::next()
}

#[tauri::command]
pub async fn media_previous() -> Result<(), String> {
    windows_impl::previous()
}
