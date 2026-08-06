//! System-wide audio equalizer (0.9.2) — by driving Equalizer APO.
//!
//! Feasibility (the three options weighed):
//! (a) DRIVE EQUALIZER APO — chosen. E-APO is the de-facto Windows
//!     system-wide EQ: an Audio Processing Object installed into the render
//!     chain of the user's output device, with a text config it hot-reloads
//!     on change. We write our band gains to our own include file and wire
//!     one `Include:` line into its config.txt. True system-wide EQ, no
//!     drivers of our own, fully reversible. The trade: the user must have
//!     Equalizer APO installed — the tile explains and links when absent.
//! (b) A virtual output device with our own DSP would need a signed audio
//!     driver; not shippable from this codebase.
//! (c) EQ'ing only audio this app renders would affect almost nothing — the
//!     app READS system audio for the visualizer; it doesn't play the
//!     user's music.
//!
//! Threading: everything here does file/registry I/O, so the commands are
//! async + spawn_blocking (the 0.6.3 sync-command lesson).

use serde::Serialize;

/// The classic 10 ISO octave bands, Hz. The frontend renders one slider per
/// entry; `eq_apply` receives gains in the same order.
pub const EQ_BANDS_HZ: [f32; 10] =
    [31.5, 63.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0];

/// Marker + filename for everything we write. The include file is entirely
/// ours; config.txt gets exactly one marked line appended, once.
pub const INCLUDE_FILE: &str = "2ndmonitor-eq.txt";
pub const INCLUDE_LINE: &str = "Include: 2ndmonitor-eq.txt";

pub fn clamp_gain(g: f32) -> f32 {
    if !g.is_finite() { return 0.0; }
    g.clamp(-12.0, 12.0)
}

/// Renders our include-file content. Pure — unit-tested below.
///
/// Disabled → a comment-only file: E-APO parses it to nothing, which is a
/// clean bypass without touching config.txt again. Enabled → an auto preamp
/// that offsets the largest boost (so cranking a band can't clip the master
/// bus) plus one `GraphicEQ:` line; E-APO interpolates smoothly between the
/// 10 points.
pub fn build_eq_config(gains: &[f32], enabled: bool) -> String {
    let mut out = String::from("# Written by 2ndMonitor — edits will be overwritten.\n");
    if !enabled {
        out.push_str("# EQ disabled.\n");
        return out;
    }
    let gains: Vec<f32> = (0..EQ_BANDS_HZ.len())
        .map(|i| clamp_gain(gains.get(i).copied().unwrap_or(0.0)))
        .collect();
    let max_boost = gains.iter().copied().fold(0.0_f32, f32::max);
    if max_boost > 0.0 {
        out.push_str(&format!("Preamp: {:.1} dB\n", -max_boost));
    }
    let points: Vec<String> = EQ_BANDS_HZ
        .iter()
        .zip(&gains)
        .map(|(hz, g)| format!("{} {:.1}", hz, g))
        .collect();
    out.push_str(&format!("GraphicEQ: {}\n", points.join("; ")));
    out
}

/// Ensures config.txt pulls our include file in. Returns `None` when the
/// line is already there (nothing to write), else the new content. Pure —
/// unit-tested below.
pub fn ensure_include(config: &str) -> Option<String> {
    if config.lines().any(|l| l.trim() == INCLUDE_LINE) {
        return None;
    }
    let mut out = config.to_string();
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    out.push_str(INCLUDE_LINE);
    out.push('\n');
    Some(out)
}

#[derive(Debug, Clone, Serialize)]
pub struct EqStatus {
    /// False off Windows — the tile hides the section entirely.
    pub supported: bool,
    /// Equalizer APO found (registry or default paths).
    pub installed: bool,
    /// Where our include file goes, for display/diagnostics.
    pub config_dir: Option<String>,
}

#[tauri::command]
pub async fn eq_status() -> EqStatus {
    tauri::async_runtime::spawn_blocking(|| {
        #[cfg(windows)]
        {
            let dir = windows_impl::config_dir();
            EqStatus {
                supported: true,
                installed: dir.is_some(),
                config_dir: dir.map(|p| p.to_string_lossy().into_owned()),
            }
        }
        #[cfg(not(windows))]
        EqStatus { supported: false, installed: false, config_dir: None }
    })
    .await
    .unwrap_or(EqStatus { supported: false, installed: false, config_dir: None })
}

/// Writes the gains (dB, one per EQ_BANDS_HZ entry) into Equalizer APO's
/// config chain. E-APO watches its config files and applies within ~100ms —
/// no restart, no elevation (its installer leaves `config/` user-writable).
#[tauri::command]
pub async fn eq_apply(gains: Vec<f32>, enabled: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        {
            windows_impl::apply(&gains, enabled)
        }
        #[cfg(not(windows))]
        {
            let _ = (gains, enabled);
            Err("The system equalizer requires Windows (Equalizer APO)".to_string())
        }
    })
    .await
    .map_err(|e| format!("eq task failed: {e}"))?
}

#[cfg(windows)]
mod windows_impl {
    use super::{build_eq_config, ensure_include, INCLUDE_FILE};
    use std::path::PathBuf;

    /// E-APO's installer records InstallPath under HKLM\SOFTWARE\EqualizerAPO.
    /// Fall back to the default install dirs for manual/portable setups.
    pub(super) fn install_dir() -> Option<PathBuf> {
        if let Some(p) = registry_install_path() {
            if p.join("config").is_dir() {
                return Some(p);
            }
        }
        for env in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Ok(base) = std::env::var(env) {
                let p = PathBuf::from(base).join("EqualizerAPO");
                if p.join("config").is_dir() {
                    return Some(p);
                }
            }
        }
        None
    }

    pub(super) fn config_dir() -> Option<PathBuf> {
        install_dir().map(|p| p.join("config"))
    }

    fn registry_install_path() -> Option<PathBuf> {
        use windows::core::w;
        use windows::Win32::System::Registry::{
            RegCloseKey, RegGetValueW, RegOpenKeyExW, HKEY, HKEY_LOCAL_MACHINE, KEY_READ,
            RRF_RT_REG_SZ,
        };
        unsafe {
            let mut key = HKEY::default();
            if RegOpenKeyExW(
                HKEY_LOCAL_MACHINE,
                w!("SOFTWARE\\EqualizerAPO"),
                0,
                KEY_READ,
                &mut key,
            )
            .is_err()
            {
                return None;
            }
            let mut buf = [0u16; 512];
            let mut len = (buf.len() * 2) as u32;
            let got = RegGetValueW(
                key,
                None,
                w!("InstallPath"),
                RRF_RT_REG_SZ,
                None,
                Some(buf.as_mut_ptr() as *mut _),
                Some(&mut len),
            );
            let _ = RegCloseKey(key);
            if got.is_err() {
                return None;
            }
            let chars = (len as usize / 2).saturating_sub(1); // trailing NUL
            Some(PathBuf::from(String::from_utf16_lossy(&buf[..chars])))
        }
    }

    pub(super) fn apply(gains: &[f32], enabled: bool) -> Result<(), String> {
        let dir = config_dir().ok_or_else(|| {
            "Equalizer APO is not installed — install it (and run its Configurator once), then try again"
                .to_string()
        })?;
        std::fs::write(dir.join(INCLUDE_FILE), build_eq_config(gains, enabled))
            .map_err(|e| format!("could not write the EQ file: {e}"))?;
        let cfg_path = dir.join("config.txt");
        let cfg = std::fs::read_to_string(&cfg_path).unwrap_or_default();
        if let Some(updated) = ensure_include(&cfg) {
            std::fs::write(&cfg_path, updated)
                .map_err(|e| format!("could not update config.txt: {e}"))?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabled_config_is_comment_only() {
        let s = build_eq_config(&[3.0; 10], false);
        assert!(s.lines().all(|l| l.starts_with('#')), "{s}");
    }

    #[test]
    fn enabled_config_has_graphiceq_with_all_ten_bands() {
        let s = build_eq_config(&[0.0; 10], true);
        let line = s.lines().find(|l| l.starts_with("GraphicEQ:")).expect("GraphicEQ line");
        assert_eq!(line.matches(';').count(), 9); // 10 points, 9 separators
        assert!(line.contains("31.5 0.0") && line.contains("16000 0.0"), "{line}");
    }

    #[test]
    fn preamp_offsets_the_largest_boost_only_when_boosting() {
        let mut gains = [0.0_f32; 10];
        gains[2] = 6.0;
        gains[7] = 3.0;
        let s = build_eq_config(&gains, true);
        assert!(s.contains("Preamp: -6.0 dB"), "{s}");
        let cut_only = build_eq_config(&[-4.0; 10], true);
        assert!(!cut_only.contains("Preamp"), "{cut_only}");
    }

    #[test]
    fn gains_are_clamped_and_missing_bands_default_to_flat() {
        let s = build_eq_config(&[99.0, f32::NAN], true);
        let line = s.lines().find(|l| l.starts_with("GraphicEQ:")).unwrap();
        assert!(line.starts_with("GraphicEQ: 31.5 12.0; 63 0.0; 125 0.0"), "{line}");
    }

    #[test]
    fn ensure_include_appends_once_and_only_once() {
        let first = ensure_include("Device: all\n").expect("should append");
        assert!(first.ends_with(&format!("{INCLUDE_LINE}\n")));
        assert_eq!(ensure_include(&first), None, "second call must be a no-op");
        // Whitespace-tolerant: an indented existing line still counts.
        assert_eq!(ensure_include(&format!("  {INCLUDE_LINE}  \n")), None);
    }

    #[test]
    fn ensure_include_handles_missing_trailing_newline() {
        let out = ensure_include("Preamp: -2 dB").unwrap();
        assert!(out.contains("Preamp: -2 dB\nInclude:"), "{out}");
    }
}
