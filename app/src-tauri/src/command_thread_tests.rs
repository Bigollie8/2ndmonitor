//! A synchronous command runs on the native window thread. Keep this small
//! inventory explicit so a new disk/network/device command cannot silently
//! reintroduce the startup and Settings freezes.

#[test]
fn window_thread_commands_are_limited_to_reviewed_short_operations() {
    let allowed = [
        // OS actions and foreground metadata; no network or directory walks.
        "app_open_url", "app_copy_text", "app_send_hotkey", "foreground_get",
        // Atomic flags, cached state, or messages to existing workers.
        "set_audio_emit_hz", "set_waveform_enabled", "set_stereo_waveform_enabled",
        "set_content_editing", "set_claude_active", "set_close_to_tray",
        "mixer_set_master_volume", "mixer_set_master_mute", "mixer_set_session_volume",
        "mixer_set_session_mute", "mixer_set_default_output", "mixer_refresh",
        "set_mixer_active", "set_weather_location", "weather_current", "sandbox_token",
    ];
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut seen = Vec::new();
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().and_then(|s| s.to_str()) != Some("rs") { continue; }
        let source = std::fs::read_to_string(&path).unwrap();
        let mut lines = source.lines();
        while let Some(line) = lines.next() {
            if line.trim() != "#[tauri::command]" { continue; }
            let signature = lines.next().expect("command signature").trim();
            if let Some(rest) = signature.strip_prefix("pub fn ") {
                let name = rest.split(['<', '(']).next().unwrap();
                assert!(allowed.contains(&name),
                    "{}: {name} runs on the window thread; use async + spawn_blocking for blocking work",
                    path.display());
                seen.push(name.to_string());
            } else {
                assert!(signature.starts_with("pub async fn "),
                    "unrecognized command declaration: {signature}");
            }
        }
    }
    assert_eq!(seen.len(), allowed.len(), "update the reviewed command inventory");
}

#[test]
fn marketplace_commands_dispatch_blocking_work_off_the_async_executor() {
    let source = include_str!("marketplace.rs").replace("\r\n", "\n");
    let commands: Vec<_> = source.split("\n#[tauri::command]\n").skip(1).collect();
    assert!(!commands.is_empty(), "must inspect the marketplace IPC declarations");
    for command in commands {
        let body = command.split("\n}\n").next().unwrap();
        assert!(body.trim_start().starts_with("pub async fn "));
        assert!(body.contains("spawn_blocking"),
            "marketplace IPC must dispatch its synchronous work to a blocking worker: {}",
            body.lines().nth(1).unwrap_or_default());
    }
}
