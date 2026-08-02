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
    /// Lowercased executable basename — the stable identity of a source.
    pub exe: String,
    /// Friendly name for display, e.g. "Spotify".
    pub name: String,
    pub icon: Option<String>,
}

/// Apps currently holding an audio session, deduped by executable. Drives the
/// Settings source picker. System-sounds has no executable and is excluded:
/// there is no process tree to include or exclude.
#[tauri::command]
pub fn audio_sources_list() -> Result<Vec<SourceOption>, String> {
    let sessions = crate::mixer::sessions_snapshot()?;
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for s in sessions {
        if s.is_system_sounds { continue; }
        let Some(exe) = s.exe.clone() else { continue };
        if !seen.insert(exe.clone()) { continue; }
        out.push(SourceOption { exe, name: s.name, icon: s.icon });
    }
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
}
