//! Crash legibility (0.9.14). Before this, a Rust panic on a command thread
//! or a background worker took the process down with nothing a user could
//! send us — "random crashes" with no repro. The hook below turns every
//! panic into a line in a persistent log the user can find from Settings →
//! Advanced and paste into a report.
//!
//! Scope, honestly: a panic hook LOGS; it does not stop the unwind. Tauri
//! command threads and our own `thread::spawn` workers die the same way they
//! did — but now with a timestamp, message and file:line on disk first. The
//! file is capped so it can never grow without bound. Release uses panic=abort:
//! after this hook runs the packaged process terminates, rather than unwinding.

use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};

const FILE_NAME: &str = "crash.log";
/// Keep the log small: when it passes this, the oldest half is dropped.
const CAP_BYTES: u64 = 512 * 1024;
static LOG_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

fn log_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join(FILE_NAME))
}

fn append_line(path: &PathBuf, line: &str) {
    let _guard = LOG_LOCK.lock();
    // Trim first so a runaway panic loop can't fill the disk.
    if let Ok(meta) = std::fs::metadata(path) {
        if meta.len() > CAP_BYTES {
            if let Ok(text) = std::fs::read_to_string(path) {
                let mut start = text.len() / 2;
                while !text.is_char_boundary(start) {
                    start += 1;
                }
                let keep = &text[start..];
                let _ = std::fs::write(path, keep);
            }
        }
    }
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
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
    append_line(
        &path,
        &format!("[{}] start v{}", now_iso(), env!("CARGO_PKG_VERSION")),
    );
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
        let thread = std::thread::current()
            .name()
            .unwrap_or("<unnamed>")
            .to_string();
        append_line(
            &path,
            &format!(
                "[{}] panic pid={} in thread '{thread}' at {loc}: {msg}\n{}",
                now_iso(),
                std::process::id(),
                std::backtrace::Backtrace::force_capture()
            ),
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
    use super::{append_line, now_iso, CAP_BYTES};

    #[test]
    fn rotation_handles_multibyte_text_without_panicking() {
        let path = std::env::temp_dir().join(format!("hub-crash-test-{}.log", std::process::id()));
        let text = "€".repeat(CAP_BYTES as usize / 3 + 2);
        std::fs::write(&path, text).unwrap();
        append_line(&path, "failure context");
        let saved = std::fs::read_to_string(&path).unwrap();
        assert!(saved.ends_with("failure context\n"));
        assert!(saved.len() < CAP_BYTES as usize);
        std::fs::remove_file(path).unwrap();
    }

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

/// Sparse lifecycle diagnostics, not a polling loop. Never records page URLs.
pub fn record<R: Runtime>(app: &AppHandle<R>, message: &str) {
    if let Some(path) = log_path(app) {
        append_line(
            &path,
            &format!("[{}] pid={} {message}", now_iso(), std::process::id()),
        );
    }
}

/// Covers main, browser-player and web-tile webviews, including ones created
/// through the JS API. WebView2 child crashes do not invoke Rust's panic hook.
pub fn plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("crash-diagnostics")
        .on_webview_ready(|webview| {
            let app = webview.app_handle().clone();
            let label = webview.label().to_string();
            record(&app, &format!("webview ready label={label}"));
            #[cfg(windows)]
            {
                let failure_app = app.clone();
                let result = webview.with_webview(move |native| unsafe {
                    use webview2_com::{ProcessFailedEventHandler, Microsoft::Web::WebView2::Win32::*};
                    let callback_app = failure_app.clone();
                    let callback_label = label.clone();
                    let handler = ProcessFailedEventHandler::create(Box::new(move |_, args| {
                        let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND(0);
                        use webview_windows_core::Interface;
                        let status = args.as_ref().map(|args| args.ProcessFailedKind(&mut kind));
                        let detail = args.and_then(|args| args.cast::<ICoreWebView2ProcessFailedEventArgs2>().ok())
                            .map(|args| {
                                let mut reason = COREWEBVIEW2_PROCESS_FAILED_REASON(0);
                                let mut exit_code = 0;
                                let reason_status = args.Reason(&mut reason);
                                let exit_status = args.ExitCode(&mut exit_code);
                                format!("reason={} exit_code={exit_code} reason_status={reason_status:?} exit_status={exit_status:?}", reason.0)
                            });
                        record(&callback_app, &format!("WebView2 ProcessFailed label={callback_label} kind={} status={status:?} detail={detail:?}", kind.0));
                        Ok(())
                    }));
                    let result = native.controller().CoreWebView2().and_then(|core| {
                        let mut token = 0;
                        // The COM event source owns the handler until this webview closes.
                        core.add_ProcessFailed(&handler, &mut token)
                    });
                    match result {
                        Ok(()) => record(&failure_app, &format!("ProcessFailed handler attached label={label}")),
                        Err(error) => record(&failure_app, &format!("ProcessFailed registration failed label={label}: {error}")),
                    }
                });
                if let Err(error) = result { record(&app, &format!("with_webview failed: {error}")); }
            }
        })
        .on_event(|app, event| match event {
            tauri::RunEvent::ExitRequested { .. } => record(app, "exit requested"),
            tauri::RunEvent::Exit => record(app, "event loop exit"),
            _ => {}
        })
        .build()
}
