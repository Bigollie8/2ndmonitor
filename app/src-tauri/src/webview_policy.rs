//! Keep second-monitor playback scheduled when another app has focus.
//!
//! Set this before Tauri creates any WebView2 environment. Using the process
//! environment applies the same options to the main view, JS browser player
//! and Rust web tiles, which share a WebView2 user-data directory. It also
//! preserves wry's default browser arguments and caller-supplied diagnostics.

#[cfg(any(windows, test))]
fn browser_arguments(existing: Option<std::ffi::OsString>) -> std::ffi::OsString {
    let mut args = existing.unwrap_or_default();
    args.push(" --disable-renderer-backgrounding --disable-background-timer-throttling --disable-backgrounding-occluded-windows");
    args
}

pub fn configure() {
    #[cfg(windows)]
    std::env::set_var(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        browser_arguments(std::env::var_os("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS")),
    );
}

#[cfg(test)]
mod tests {
    use super::browser_arguments;

    #[test]
    fn playback_policy_preserves_existing_arguments() {
        let existing = "--remote-debugging-port=9222 --log-file=\"C:\\logs with spaces\\浏览器.log\"";
        let args = browser_arguments(Some(existing.into()));
        let args = args.to_str().unwrap();
        assert!(args.starts_with(existing));
        for flag in [
            "--disable-renderer-backgrounding",
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
        ] {
            assert!(args.split_whitespace().any(|arg| arg == flag));
            assert!(browser_arguments(None).to_str().unwrap().contains(flag));
        }
    }
}
