//! Crash legibility (0.9.14). Before this, a Rust panic on a command thread
//! or a background worker took the process down with nothing a user could
//! send us — "random crashes" with no repro. The hook below turns every
//! panic into a line in a persistent log the user can find from Settings →
//! Advanced and paste into a report.
//!
//! Scope, honestly: a panic hook LOGS; it does not stop the unwind. Tauri
//! command threads and our own `thread::spawn` workers die the same way they
//! did — but now with a timestamp, message and file:line on disk first. The
//! file is capped so it can never grow without bound.

use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};

const FILE_NAME: &str = "crash.log";
/// Keep the log small: when it passes this, the oldest half is dropped.
const CAP_BYTES: u64 = 512 * 1024;

fn log_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join(FILE_NAME))
}

fn append_line(path: &PathBuf, line: &str) {
    // Trim first so a runaway panic loop can't fill the disk.
    if let Ok(meta) = std::fs::metadata(path) {
        if meta.len() > CAP_BYTES {
            if let Ok(text) = std::fs::read_to_string(path) {
                let keep = &text[text.len() / 2..];
                let _ = std::fs::write(path, keep);
            }
        }
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{line}");
    }
}

fn now_iso() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Civil-from-days (Howard Hinnant) — enough for a log stamp, no chrono.
    let days = (secs / 86_400) as i64;
    let (h, m, s) = ((secs % 86_400) / 3600, (secs % 3600) / 60, secs % 60);
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mo <= 2 { y + 1 } else { y };
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}Z")
}

/// Install the process-wide panic hook. Call once from `setup`. The hook
/// chains to the default one so the console output developers rely on is
/// unchanged; it only ADDS the file write.
pub fn install<R: Runtime>(app: &AppHandle<R>) {
    let Some(path) = log_path(app) else { return };
    append_line(&path, &format!("[{}] start v{}", now_iso(), env!("CARGO_PKG_VERSION")));
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let msg = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "<non-string panic payload>".to_string());
        let loc = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "<unknown location>".to_string());
        let thread = std::thread::current().name().unwrap_or("<unnamed>").to_string();
        append_line(
            &path,
            &format!("[{}] panic in thread '{thread}' at {loc}: {msg}", now_iso()),
        );
        default_hook(info);
    }));
}

/// Where the log lives — Settings → Advanced shows this so a user can find
/// and share it. Also writes a marker line so an empty log still proves the
/// path works.
#[tauri::command]
pub fn crash_log_path<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    let path = log_path(&app).ok_or("app data dir unavailable")?;
    if !path.exists() {
        append_line(&path, &format!("[{}] log created", now_iso()));
    }
    Ok(path.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::now_iso;

    #[test]
    fn timestamp_is_iso_shaped() {
        let s = now_iso();
        assert_eq!(s.len(), 20, "{s}");
        assert!(s.ends_with('Z'));
        assert_eq!(&s[4..5], "-");
        assert_eq!(&s[10..11], "T");
        assert!(s.starts_with("20"), "{s}");
    }
}
