//! # Command ACL
//!
//! Every command registered in [`run`]'s `invoke_handler` must also appear in
//! `permissions/app-commands.toml`, which is what makes Tauri's ACL apply to
//! app-defined commands at all (see the long comment at the top of that file).
//! A command missing from it is rejected in *every* context with
//! "Command <name> not allowed by ACL"; a command present in the TOML but no
//! longer registered is dead weight in the allowlist. The test at the bottom of
//! this file pins the two lists together so neither can drift silently.

mod actions;
mod audio;
mod claude;
mod discord;
mod discord_rpc;
mod docker_tile;
mod foreground;
mod lyrics;
mod market;
mod mixer;
mod nowplaying;
mod marketplace;
mod presets;
mod sandbox;
mod secrets;
mod seed;
mod tiles;
mod visualizers;
mod spotify;
mod sysmon;
mod tray;
mod tweaks;
mod weather;
mod webtiles;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Single-instance must be the FIRST plugin registered so a second
        // launch is intercepted before any other plugin does work. The
        // callback re-surfaces the existing window instead of opening a new one.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            use tauri::{Emitter, Manager};
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
                let _ = win.emit("hub://window-visibility", true);
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_dialog::init())
        // Serves the scripted-visualizer sandbox document with its own CSP
        // header. Must be registered before `build()`: the protocol table is
        // copied onto each pending webview at creation time
        // (tauri-2.10.3/src/manager/webview.rs::prepare_pending_webview), so a
        // scheme added later is never attached to the main window.
        // See sandbox.rs for why srcdoc could not work in a packaged build.
        .register_uri_scheme_protocol(sandbox::SCHEME, sandbox::handle)
        .invoke_handler(tauri::generate_handler![
            webtiles::position_tile,
            webtiles::close_tile,
            nowplaying::media_toggle,
            nowplaying::media_next,
            nowplaying::media_previous,
            discord::discord_connect,
            discord::discord_disconnect,
            discord::discord_status,
            discord::discord_get_client_id,
            discord_rpc::discord_rpc_status,
            discord_rpc::discord_rpc_set_voice_settings,
            discord_rpc::discord_rpc_get_voice_settings,
            discord_rpc::discord_rpc_leave_voice,
            actions::app_open_url,
            actions::app_copy_text,
            actions::app_send_hotkey,
            market::fetch_stock_quotes,
            market::fetch_tide_predictions,
            market::fetch_github_prs,
            market::fetch_aircraft_states,
            foreground::foreground_get,
            docker_tile::docker_list_containers,
            spotify::spotify_status,
            spotify::spotify_connect,
            spotify::spotify_disconnect,
            spotify::spotify_get_client_id,
            spotify::spotify_set_volume,
            tweaks::tweaks_load,
            tweaks::tweaks_save,
            tweaks::tweaks_export,
            tweaks::tweaks_import,
            weather::set_weather_location,
            audio::set_audio_emit_hz,
            audio::set_waveform_enabled,
            presets::presets_list,
            presets::presets_read,
            visualizers::visualizers_list,
            visualizers::visualizers_read,
            visualizers::visualizers_write,
            tiles::tiles_list,
            tiles::tiles_read,
            marketplace::marketplace_fetch_index,
            marketplace::marketplace_fetch_preview,
            marketplace::marketplace_install,
            marketplace::marketplace_uninstall,
            marketplace::broker_fetch,
            seed::seed_sync,
            mixer::mixer_set_master_volume,
            mixer::mixer_set_master_mute,
            mixer::mixer_set_session_volume,
            mixer::mixer_set_session_mute,
            mixer::mixer_set_default_output,
            mixer::mixer_refresh,
            mixer::set_mixer_active,
            secrets::secret_get,
            secrets::secret_set,
            secrets::secret_delete,
            tray::set_close_to_tray,
            sandbox::sandbox_token,
        ])
        .setup(|app| {
            sysmon::spawn(app.handle().clone());
            nowplaying::spawn(app.handle().clone());
            lyrics::spawn(app.handle().clone());
            audio::spawn(app.handle().clone());
            visualizers::spawn_watcher(app.handle().clone());
            tiles::spawn_watcher(app.handle().clone());
            mixer::spawn(app.handle().clone());
            claude::spawn(app.handle().clone());
            weather::spawn(app.handle().clone());
            discord::spawn(app.handle().clone());
            discord_rpc::spawn(app.handle().clone());
            spotify::spawn(app.handle().clone());
            tray::init(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" && tray::close_to_tray_enabled() {
                    use tauri::Emitter;
                    api.prevent_close();
                    let _ = window.hide();
                    let _ = window.emit("hub://window-visibility", false);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod acl_tests {
    /// The `invoke_handler` list, read out of this file's own source. There is
    /// no runtime accessor for it — `generate_handler!` expands to a closure —
    /// so the source text is the only place both lists can be compared.
    fn registered_commands() -> Vec<String> {
        let src = include_str!("lib.rs");
        let body = src
            .split_once("tauri::generate_handler![")
            .expect("invoke_handler list present")
            .1
            .split_once(']')
            .expect("invoke_handler list is terminated")
            .0;
        body.lines()
            .map(|l| l.trim().trim_end_matches(',').trim())
            .filter(|l| !l.is_empty() && !l.starts_with("//"))
            .map(|l| l.rsplit("::").next().unwrap().to_string())
            .collect()
    }

    /// The `commands.allow` array of `permissions/app-commands.toml`, likewise
    /// read as text — the crate has no TOML parser and pulling one in as a
    /// dev-dependency for six lines of extraction is not worth it.
    fn allowlisted_commands() -> Vec<String> {
        let src = include_str!("../permissions/app-commands.toml");
        let body = src
            .split_once("commands.allow = [")
            .expect("commands.allow array present")
            .1
            .split_once(']')
            .expect("commands.allow array is terminated")
            .0;
        body.lines()
            .map(str::trim)
            .filter(|l| !l.starts_with('#'))
            .filter_map(|l| l.split('"').nth(1))
            .map(str::to_string)
            .collect()
    }

    #[test]
    fn every_registered_command_is_in_the_app_acl_manifest() {
        let registered = registered_commands();
        assert!(
            registered.len() > 40,
            "extraction is broken, not the allowlist: parsed only {} commands",
            registered.len()
        );
        let allowed = allowlisted_commands();

        let missing: Vec<_> = registered
            .iter()
            .filter(|c| !allowed.contains(c))
            .collect();
        assert!(
            missing.is_empty(),
            "registered but not allowlisted in permissions/app-commands.toml — \
             these would be rejected everywhere as \"not allowed by ACL\": {missing:?}"
        );

        let stale: Vec<_> = allowed
            .iter()
            .filter(|c| !registered.contains(c))
            .collect();
        assert!(
            stale.is_empty(),
            "allowlisted but no longer registered in invoke_handler: {stale:?}"
        );
    }

    #[test]
    fn the_app_acl_manifest_is_scoped_to_the_main_webview_only() {
        // The manifest alone only turns enforcement ON. What actually keeps a
        // remote page in the `browser-tile` child webview out is the capability:
        // `webviews` (not `windows`, which `resolve_access` treats as an OR and
        // which would re-admit every webview of the main window) plus a local-
        // only execution context (no `remote` block).
        let cap: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/app-commands.json"))
                .expect("capability file is valid JSON");
        assert_eq!(cap["webviews"], serde_json::json!(["main"]), "must be webview-scoped");
        assert!(
            cap.get("windows").is_none(),
            "a `windows` entry would also match the browser-tile child webview, \
             because resolve_access matches windows OR webviews"
        );
        assert_eq!(cap["local"], serde_json::json!(true));
        assert!(
            cap.get("remote").is_none(),
            "granting a remote origin would undo the whole fix"
        );
        assert_eq!(cap["permissions"], serde_json::json!(["allow-app-commands"]));
    }
}
