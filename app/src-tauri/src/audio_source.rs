//! What the visualizer is listening to, and the pure decision of which
//! capture backend that implies right now. No Windows API here on purpose:
//! this is the part worth unit-testing.

use serde::{Deserialize, Deserializer, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "mode", rename_all = "lowercase")]
pub enum Source {
    Mix,
    Only { exe: String },
    Except { exe: String },
}

impl Default for Source {
    fn default() -> Self { Source::Mix }
}

// Hand-rolled so exe names normalize on the way in — every comparison
// downstream (session lookup, sensitivity keys) assumes lowercase.
impl<'de> Deserialize<'de> for Source {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(tag = "mode", rename_all = "lowercase")]
        enum Raw { Mix, Only { exe: String }, Except { exe: String } }
        Ok(match Raw::deserialize(d)? {
            Raw::Mix => Source::Mix,
            Raw::Only { exe } => Source::Only { exe: exe.to_lowercase() },
            Raw::Except { exe } => Source::Except { exe: exe.to_lowercase() },
        })
    }
}

/// Stable key for the per-source sensitivity map. "Only Spotify" and
/// "everything except Spotify" are different listening situations and get
/// different gain, so the mode is part of the key, not just the exe.
pub fn source_key(s: &Source) -> String {
    match s {
        Source::Mix => "mix".to_string(),
        Source::Only { exe } => format!("only:{exe}"),
        Source::Except { exe } => format!("except:{exe}"),
    }
}

pub fn target_exe(s: &Source) -> Option<&str> {
    match s {
        Source::Mix => None,
        Source::Only { exe } | Source::Except { exe } => Some(exe),
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct SourceOption {
    /// The stable identity of a source: a lowercased executable basename on
    /// Windows (`spotify.exe`), a lowercased bundle identifier on macOS
    /// (`com.spotify.client`). Nothing above this line inspects its shape —
    /// it is matched, keyed and round-tripped as an opaque string on both
    /// platforms (see `bundle_ids_behave_exactly_like_exe_names` below).
    pub exe: String,
    /// Friendly name for display, e.g. "Spotify".
    pub name: String,
    pub icon: Option<String>,
}

/// Apps currently holding an audio session, deduped by executable. System
/// -sounds has no executable and is excluded: there is no process tree to
/// include or exclude.
#[cfg(not(target_os = "macos"))]
fn source_options() -> Result<Vec<SourceOption>, String> {
    let sessions = crate::mixer::sessions_snapshot()?;
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for s in sessions {
        if s.is_system_sounds { continue; }
        let Some(exe) = s.exe.clone() else { continue };
        if !seen.insert(exe.clone()) { continue; }
        out.push(SourceOption { exe, name: s.name, icon: s.icon });
    }
    Ok(out)
}

/// Apps with a Core Audio process object — the macOS equivalent of holding an
/// audio session — already deduped by bundle id. Icons would mean rendering an
/// `NSImage` to PNG on every poll; the picker falls back to the app's name
/// without one, so that is left for later rather than paid for here.
#[cfg(target_os = "macos")]
fn source_options() -> Result<Vec<SourceOption>, String> {
    Ok(crate::mixer::audio_process_apps()?
        .into_iter()
        .map(|a| SourceOption { exe: a.bundle_id, name: a.name, icon: None })
        .collect())
}

/// Drives the Settings source picker.
#[tauri::command]
pub fn audio_sources_list() -> Result<Vec<SourceOption>, String> {
    let mut out = source_options()?;
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Active {
    Mix,
    Process { pid: u32, exclude: bool },
}

/// Which backend should be live, given what the user asked for and whether
/// the target app currently holds an audio session. Absent target → Mix,
/// which is the "auto-reattach, mix meanwhile" behavior the spec chose.
pub fn decide(requested: &Source, session_pid: Option<u32>) -> Active {
    match (requested, session_pid) {
        (Source::Mix, _) | (_, None) => Active::Mix,
        (Source::Only { .. }, Some(pid)) => Active::Process { pid, exclude: false },
        (Source::Except { .. }, Some(pid)) => Active::Process { pid, exclude: true },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_key_distinguishes_only_from_except() {
        assert_eq!(source_key(&Source::Mix), "mix");
        assert_eq!(source_key(&Source::Only { exe: "spotify.exe".into() }), "only:spotify.exe");
        assert_eq!(source_key(&Source::Except { exe: "discord.exe".into() }), "except:discord.exe");
    }

    #[test]
    fn mix_is_always_active_as_mix() {
        assert_eq!(decide(&Source::Mix, None), Active::Mix);
        assert_eq!(decide(&Source::Mix, Some(1234)), Active::Mix);
    }

    #[test]
    fn only_falls_back_to_mix_when_the_app_has_no_session() {
        let s = Source::Only { exe: "spotify.exe".into() };
        assert_eq!(decide(&s, None), Active::Mix);
    }

    #[test]
    fn only_attaches_include_mode_when_the_app_is_present() {
        let s = Source::Only { exe: "spotify.exe".into() };
        assert_eq!(decide(&s, Some(4242)), Active::Process { pid: 4242, exclude: false });
    }

    #[test]
    fn except_attaches_exclude_mode_when_the_app_is_present() {
        let s = Source::Except { exe: "discord.exe".into() };
        assert_eq!(decide(&s, Some(77)), Active::Process { pid: 77, exclude: true });
    }

    #[test]
    fn except_falls_back_to_mix_when_the_app_is_absent() {
        // Nothing to exclude means the plain mix is already the right answer,
        // and it avoids paying for a process-loopback client that filters nothing.
        let s = Source::Except { exe: "discord.exe".into() };
        assert_eq!(decide(&s, None), Active::Mix);
    }

    #[test]
    fn exe_names_normalize_to_lowercase_on_parse() {
        let s: Source = serde_json::from_str(r#"{"mode":"only","exe":"Spotify.EXE"}"#).unwrap();
        assert_eq!(s, Source::Only { exe: "spotify.exe".into() });
    }

    /// macOS puts a bundle id (`com.spotify.client`) in the same `exe` field
    /// Windows puts `spotify.exe` in. Nothing between the picker and the
    /// capture backend is allowed to care which it is holding — the sensitivity
    /// map is keyed on `source_key`'s output and the frontend's `parseSourceKey`
    /// splits it back on the first `:`, so a dot-separated identifier has to
    /// behave exactly as an exe name does at every step. Runs on all platforms
    /// deliberately: this is the seam, and a Windows-only CI run must catch a
    /// break in it.
    #[test]
    fn bundle_ids_behave_exactly_like_exe_names() {
        let exe: Source = serde_json::from_str(r#"{"mode":"only","exe":"spotify.exe"}"#).unwrap();
        let bundle: Source =
            serde_json::from_str(r#"{"mode":"only","exe":"com.spotify.client"}"#).unwrap();
        assert_eq!(bundle, Source::Only { exe: "com.spotify.client".into() });
        assert_eq!(source_key(&bundle), "only:com.spotify.client");
        // Same shape of key, differing only in the identifier itself.
        assert_eq!(
            source_key(&exe).split_once(':').map(|(m, _)| m),
            source_key(&bundle).split_once(':').map(|(m, _)| m),
        );
        assert_eq!(target_exe(&bundle), Some("com.spotify.client"));
        assert_eq!(
            decide(&bundle, Some(4242)),
            Active::Process { pid: 4242, exclude: false }
        );

        // Bundle ids are *not* reliably lowercase (`com.apple.Music`), so the
        // same normalization that keeps `Spotify.EXE` and `spotify.exe` on one
        // sensitivity key has to apply here too.
        let mixed: Source =
            serde_json::from_str(r#"{"mode":"except","exe":"com.apple.Music"}"#).unwrap();
        assert_eq!(mixed, Source::Except { exe: "com.apple.music".into() });
        assert_eq!(source_key(&mixed), "except:com.apple.music");
        assert_eq!(decide(&mixed, Some(7)), Active::Process { pid: 7, exclude: true });
        assert_eq!(decide(&mixed, None), Active::Mix);

        // And it survives a serialize → deserialize round trip unchanged, which
        // is the path a persisted tweaks file takes on every launch.
        let json = serde_json::to_string(&bundle).unwrap();
        let back: Source = serde_json::from_str(&json).unwrap();
        assert_eq!(back, bundle);
        assert_eq!(source_key(&back), source_key(&bundle));
    }
}
