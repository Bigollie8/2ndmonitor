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
//!
//! Crash note (0.9.19). A WER minidump of a 0.9.18 crash (exception
//! 0xc0000409, FAST_FAIL_FATAL_APP_EXIT with HRESULT E_HANDLE) showed the
//! fail-fast on an unnamed COM thread-pool thread: Windows.Media.MediaControl
//! → SHCORE task pool → an RPC that came back "handle is invalid" → wil
//! FAIL_FAST inside SHCORE. A fail-fast is not an exception, so nothing in
//! this process can catch it — the only lever is exposure. Two things on
//! this side fed that path: a brand-new `SessionManager` every 2 s poll
//! (`RequestAsync` per tick, each marshalling the thumbnail reference
//! across processes), and reading the thumbnail the instant the track key
//! changed — exactly when the source app is still swapping its artwork.
//! The poller now keeps ONE manager for its lifetime and only opens the
//! thumbnail once the track has been the same on two consecutive polls
//! (`ThumbnailGate`, tested below), and at most once per track.

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
    /// Application User Model ID of the GSMTC source — e.g. "Spotify.exe",
    /// "AppleInc.AppleMusicWin_nzyj5cx40ttqa!App", "msedge". The frontend uses
    /// this to label the platform pill and gate platform-specific UI (queue,
    /// volume control). Empty string when no session.
    pub source_app_id: String,
}

/// Decides when the album-art thumbnail may be opened. Pure, so it is
/// testable off Windows. Rules: a track's thumbnail is opened at most once,
/// and only after the same track key has been reported on two consecutive
/// polls — the source app is still replacing its artwork in the first
/// moments after a change, and opening the old stream then is the path the
/// 0.9.18 minidump showed fail-fasting inside SHCORE (see module docs).
#[derive(Debug, Default)]
pub struct ThumbnailGate {
    prev_seen: String,
    extracted_for: String,
}

impl ThumbnailGate {
    /// Report the track key seen on this poll; `true` means "open the
    /// thumbnail now" (and marks it done for this key).
    pub fn should_extract(&mut self, key: &str) -> bool {
        let stable = self.prev_seen == key;
        self.prev_seen = key.to_string();
        if stable && self.extracted_for != key {
            self.extracted_for = key.to_string();
            return true;
        }
        false
    }
}

#[cfg(test)]
mod gate_tests {
    use super::ThumbnailGate;

    #[test]
    fn waits_one_poll_after_a_change_then_extracts_once() {
        let mut g = ThumbnailGate::default();
        assert!(!g.should_extract("a"), "first sight: still settling");
        assert!(g.should_extract("a"), "second consecutive poll: open it");
        assert!(!g.should_extract("a"), "never twice for one track");
        assert!(!g.should_extract("a"));
    }

    #[test]
    fn a_rapid_skip_never_opens_the_intermediate_track() {
        let mut g = ThumbnailGate::default();
        assert!(!g.should_extract("a"));
        assert!(!g.should_extract("b"), "b just appeared");
        assert!(!g.should_extract("c"), "b was skipped past before it settled");
        assert!(g.should_extract("c"));
    }

    #[test]
    fn returning_to_a_track_extracts_again_after_it_settles() {
        let mut g = ThumbnailGate::default();
        g.should_extract("a");
        assert!(g.should_extract("a"));
        g.should_extract("b");
        assert!(g.should_extract("b"));
        assert!(!g.should_extract("a"), "back to a: settle first");
        assert!(g.should_extract("a"), "then re-open — the art may have changed");
    }

    #[test]
    fn an_empty_key_is_never_opened() {
        // A track with no title/artist/album has nothing worth a thumbnail
        // round-trip; the fresh gate already counts "" as extracted.
        let mut g = ThumbnailGate::default();
        assert!(!g.should_extract(""));
        assert!(!g.should_extract(""));
        assert!(!g.should_extract("a"));
        assert!(g.should_extract("a"), "a real key after the empty one still works");
    }
}

#[cfg(windows)]
mod windows_impl {
    use super::{NowPlaying, ThumbnailGate};
    use base64::Engine;
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession,
        GlobalSystemMediaTransportControlsSessionManager,
        GlobalSystemMediaTransportControlsSessionMediaProperties,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    use windows::Storage::Streams::{DataReader, IRandomAccessStreamReference};

    /// One-shot session lookup for the transport commands (play/pause/skip).
    /// Those are user actions, rare enough that a fresh manager per call is
    /// fine; the 2 s poll uses `Poller`, which keeps its manager.
    pub fn current_session() -> Option<GlobalSystemMediaTransportControlsSession> {
        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .ok()?
            .get()
            .ok()?;
        manager.GetCurrentSession().ok()
    }

    /// The poll loop's state: a long-lived session manager plus the
    /// thumbnail gate. Owned by the poll thread — no statics, no locks.
    pub struct Poller {
        manager: Option<GlobalSystemMediaTransportControlsSessionManager>,
        gate: ThumbnailGate,
    }

    impl Poller {
        pub fn new() -> Self {
            Self { manager: None, gate: ThumbnailGate::default() }
        }

        /// Cached manager, created on first use and dropped on any failure
        /// so the next poll rebuilds it. Before 0.9.19 every poll called
        /// `RequestAsync` afresh — 30 managers a minute, each marshalling
        /// the current session (and its thumbnail reference) across
        /// processes; see the module docs for what that fed.
        fn session(&mut self) -> Option<GlobalSystemMediaTransportControlsSession> {
            if self.manager.is_none() {
                self.manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
                    .ok()
                    .and_then(|op| op.get().ok());
            }
            let manager = self.manager.as_ref()?;
            match manager.GetCurrentSession() {
                Ok(session) => Some(session),
                Err(_) => {
                    self.manager = None;
                    None
                }
            }
        }

        pub fn poll(&mut self) -> NowPlaying {
            self.try_poll().unwrap_or_default()
        }

        fn try_poll(&mut self) -> windows::core::Result<NowPlaying> {
            let Some(session) = self.session() else {
                return Ok(NowPlaying::default());
            };
            let source_app_id = session
                .SourceAppUserModelId()
                .map(|s| s.to_string())
                .unwrap_or_default();
            let props = session.TryGetMediaPropertiesAsync()?.get()?;
            let timeline = session.GetTimelineProperties().ok();
            let playback = session.GetPlaybackInfo().ok();

            let title = props.Title().map(|s| s.to_string()).unwrap_or_default();
            let artist = props.Artist().map(|s| s.to_string()).unwrap_or_default();
            let album = props.AlbumTitle().map(|s| s.to_string()).unwrap_or_default();
            let track_key = format!("{title}\0{artist}\0{album}");

            // Album art only when the track has SETTLED (same key on two
            // consecutive polls) and only once per track — the bytes are
            // big, and opening the stream mid-swap is the crash path.
            let art = if self.gate.should_extract(&track_key) {
                extract_thumbnail(&props)
            } else {
                None
            };

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
                source_app_id,
            })
        }
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
    pub struct Poller;
    impl Poller {
        pub fn new() -> Self { Poller }
        pub fn poll(&mut self) -> NowPlaying { NowPlaying::default() }
    }
    pub fn toggle_play_pause() -> Result<(), String> { Err("Windows-only".into()) }
    pub fn next() -> Result<(), String> { Err("Windows-only".into()) }
    pub fn previous() -> Result<(), String> { Err("Windows-only".into()) }
}

// Cache for the last extracted art so position-only updates don't lose it.
static LAST_ART: once_cell::sync::Lazy<Mutex<Option<String>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(None));

pub fn spawn<R: Runtime>(app: AppHandle<R>) {
    // Named so a future minidump attributes this thread (the 0.9.18 dumps
    // showed it as one of many anonymous threads).
    let _ = std::thread::Builder::new().name("nowplaying-poll".into()).spawn(move || {
        let mut last_track_key: Option<String> = None;
        let mut poller = windows_impl::Poller::new();
        loop {
            let mut np = poller.poll();
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
