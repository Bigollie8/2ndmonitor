//! What the visualizer is listening to. No Windows API here on purpose:
//! this is the part worth unit-testing. Since 0.6.6 the model is a STRICT
//! include list — the mix, or up to [`MAX_APPS`] specific apps — with no
//! automatic switching between the two (audio.rs enforces the policy).

use serde::{Deserialize, Deserializer, Serialize};

/// Hard cap on concurrent per-app captures: each selected exe is a real
/// WASAPI process-loopback client. Mirrors `MAX_AUDIO_APPS` in
/// `app/src/state/audioSource.ts`.
pub const MAX_APPS: usize = 4;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "mode", rename_all = "lowercase")]
pub enum Source {
    Mix,
    /// Non-empty by construction — `normalize_apps` degrades an empty list
    /// to `Mix`, so downstream never has to define "apps of nothing".
    Apps { exes: Vec<String> },
}

impl Default for Source {
    fn default() -> Self { Source::Mix }
}

// Hand-rolled for two reasons: exe names normalize on the way in (every
// comparison downstream — session lookup, sensitivity keys — assumes
// lowercase), and the retired 0.6.4 shapes must keep deserializing. The
// frontend migrates persisted tweaks before it ever invokes us, but an old
// value can still arrive from an un-upgraded webview mid-update or a
// hand-edited settings import; mapping it here beats an invoke error that
// silently strands the capture on its previous source.
impl<'de> Deserialize<'de> for Source {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(tag = "mode", rename_all = "lowercase")]
        enum Raw {
            Mix,
            Apps { exes: Vec<String> },
            // 0.6.4 shapes. `only:x` is exactly `apps:[x]`; `except:x` has
            // no include-list equivalent and downgrades to the mix (the
            // 0.6.6 changelog says so out loud).
            Only { exe: String },
            // The exe is parsed (the old shape always carries it) but has
            // nothing to map onto — hence the allow instead of a read.
            Except {
                #[allow(dead_code)]
                exe: String,
            },
        }
        Ok(match Raw::deserialize(d)? {
            Raw::Mix => Source::Mix,
            Raw::Apps { exes } => normalize_apps(exes),
            Raw::Only { exe } => normalize_apps(vec![exe]),
            Raw::Except { .. } => Source::Mix,
        })
    }
}

/// Lowercase, drop empties, dedupe keeping first occurrence, cap at
/// [`MAX_APPS`]. An empty result degrades to `Mix`.
fn normalize_apps(exes: Vec<String>) -> Source {
    let mut out: Vec<String> = Vec::new();
    for e in exes {
        let e = e.to_lowercase();
        if e.is_empty() || out.contains(&e) {
            continue;
        }
        out.push(e);
        if out.len() == MAX_APPS {
            break;
        }
    }
    if out.is_empty() {
        Source::Mix
    } else {
        Source::Apps { exes: out }
    }
}

/// Stable key for the per-source sensitivity map — MUST agree with
/// `sourceKey` in `app/src/state/audioSource.ts`, or a user's gain silently
/// lands under a key nothing reads. Sorted so the same *set* of apps
/// resolves the same saved gain regardless of pick order.
pub fn source_key(s: &Source) -> String {
    match s {
        Source::Mix => "mix".to_string(),
        Source::Apps { exes } => {
            let mut sorted = exes.clone();
            sorted.sort();
            format!("apps:{}", sorted.join("+"))
        }
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

/// Apps currently holding an audio session, deduped by executable. Drives
/// the source picker. System-sounds has no executable and is excluded:
/// there is no process tree to include.
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

/// Pure reduction for the capture supervisor: given one session snapshot as
/// (lowercased exe, pid) pairs, the pid backing each selected exe — `None`
/// when the app has no audio session right now (it contributes silence).
/// First match wins when an app has several sessions, same as the 0.6.4
/// `find_pid_for_exe` behavior.
pub fn match_sessions(exes: &[String], sessions: &[(String, u32)]) -> Vec<Option<u32>> {
    exes.iter()
        .map(|want| sessions.iter().find(|(e, _)| e == want).map(|(_, pid)| *pid))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_key_sorts_the_set() {
        assert_eq!(source_key(&Source::Mix), "mix");
        assert_eq!(
            source_key(&Source::Apps { exes: vec!["spotify.exe".into()] }),
            "apps:spotify.exe"
        );
        assert_eq!(
            source_key(&Source::Apps { exes: vec!["spotify.exe".into(), "discord.exe".into()] }),
            "apps:discord.exe+spotify.exe"
        );
    }

    #[test]
    fn deserialize_normalizes_case_dupes_and_cap() {
        let s: Source = serde_json::from_str(
            r#"{"mode":"apps","exes":["Spotify.EXE","spotify.exe","b.exe","c.exe","d.exe","e.exe"]}"#,
        )
        .unwrap();
        assert_eq!(
            s,
            Source::Apps {
                exes: vec!["spotify.exe".into(), "b.exe".into(), "c.exe".into(), "d.exe".into()]
            }
        );
    }

    #[test]
    fn deserialize_empty_apps_degrades_to_mix() {
        let s: Source = serde_json::from_str(r#"{"mode":"apps","exes":[]}"#).unwrap();
        assert_eq!(s, Source::Mix);
    }

    #[test]
    fn deserialize_migrates_the_0_6_4_shapes() {
        let only: Source = serde_json::from_str(r#"{"mode":"only","exe":"Spotify.EXE"}"#).unwrap();
        assert_eq!(only, Source::Apps { exes: vec!["spotify.exe".into()] });
        let except: Source =
            serde_json::from_str(r#"{"mode":"except","exe":"discord.exe"}"#).unwrap();
        assert_eq!(except, Source::Mix);
    }

    #[test]
    fn match_sessions_maps_each_exe_to_its_session_pid() {
        let sessions = vec![
            ("spotify.exe".to_string(), 100u32),
            ("discord.exe".to_string(), 200u32),
        ];
        let exes = vec!["spotify.exe".to_string(), "game.exe".to_string()];
        assert_eq!(match_sessions(&exes, &sessions), vec![Some(100), None]);
    }

    #[test]
    fn match_sessions_takes_the_first_session_for_a_duplicated_exe() {
        let sessions = vec![
            ("spotify.exe".to_string(), 100u32),
            ("spotify.exe".to_string(), 101u32),
        ];
        assert_eq!(
            match_sessions(&["spotify.exe".to_string()], &sessions),
            vec![Some(100)]
        );
    }
}
