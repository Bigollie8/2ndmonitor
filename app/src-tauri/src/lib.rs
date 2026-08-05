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
mod audio_loopback;
mod audio_source;
/// Core Audio process taps — the macOS counterpart to `audio_loopback`'s
/// WASAPI process loopback.
#[cfg(target_os = "macos")]
mod audio_tap;
mod claude;
mod discord;
mod discord_rpc;
mod docker_tile;
mod foreground;
mod glass;
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
mod temps;
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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
            weather::weather_current,
            audio::set_audio_emit_hz,
            audio::set_waveform_enabled,
            audio::audio_set_source,
            audio::audio_get_source,
            audio_source::audio_sources_list,
            presets::presets_list,
            presets::presets_read,
            presets::presets_market_list,
            presets::presets_market_read,
            visualizers::visualizers_list,
            visualizers::visualizers_read,
            visualizers::visualizers_write,
            tiles::tiles_list,
            tiles::tiles_read,
            marketplace::marketplace_fetch_index,
            marketplace::marketplace_fetch_index_body,
            marketplace::marketplace_fetch_collections,
            marketplace::marketplace_fetch_creator,
            marketplace::marketplace_register,
            marketplace::marketplace_verify_account,
            marketplace::marketplace_publish_layout,
            marketplace::marketplace_follow_status,
            marketplace::marketplace_set_follow,
            marketplace::marketplace_follows_mine,
            marketplace::marketplace_fetch_favourites,
            marketplace::marketplace_set_favourite,
            marketplace::marketplace_fetch_feed,
            marketplace::marketplace_fetch_comments,
            marketplace::marketplace_post_comment,
            marketplace::marketplace_set_block,
            marketplace::marketplace_report,
            marketplace::marketplace_set_avatar,
            marketplace::marketplace_staff_whoami,
            marketplace::marketplace_staff_users,
            marketplace::marketplace_staff_reports,
            marketplace::marketplace_moderate,
            marketplace::marketplace_fetch_creators,
            marketplace::marketplace_fetch_topics,
            marketplace::marketplace_create_topic,
            marketplace::marketplace_fetch_replies,
            marketplace::marketplace_create_reply,
            marketplace::marketplace_fetch_shouts,
            marketplace::marketplace_post_shout,
            marketplace::marketplace_account_get,
            marketplace::marketplace_claim_handle,
            marketplace::marketplace_account_patch,
            marketplace::marketplace_fetch_reviews,
            marketplace::marketplace_post_review,
            marketplace::marketplace_verify_index_body,
            marketplace::marketplace_fetch_preview,
            marketplace::marketplace_fetch_media,
            marketplace::marketplace_install,
            marketplace::marketplace_uninstall,
            marketplace::broker_fetch,
            marketplace::marketplace_login,
            marketplace::marketplace_logout,
            marketplace::marketplace_session_status,
            marketplace::marketplace_fetch_ratings,
            marketplace::marketplace_rate,
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
            glass::set_glass,
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

    /// One entry per **capability**, not per file: `(label, capability object)`.
    ///
    /// Covers every capability file `tauri_build` will parse — the glob it uses
    /// is `./capabilities/**/*`, minus the generated `schemas` folder
    /// (tauri-utils-2.8.3/src/acl/build.rs::parse_capabilities). Read from disk
    /// at test time rather than `include_str!`ed, because the whole point is to
    /// notice a file that did not exist when this test was written.
    fn capability_files() -> Vec<(String, serde_json::Value)> {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities");
        let mut stack = vec![root.clone()];
        let mut out = Vec::new();
        while let Some(dir) = stack.pop() {
            for entry in std::fs::read_dir(&dir).expect("capabilities dir is readable") {
                let path = entry.expect("dir entry").path();
                if path.is_dir() {
                    // tauri-build skips this one; it holds generated schemas.
                    if path.file_name().and_then(|n| n.to_str()) != Some("schemas") {
                        stack.push(path);
                    }
                    continue;
                }
                let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                // tauri also accepts `json5`/`toml` capabilities. serde_json
                // cannot read those, so fail loudly rather than skip one and
                // report a false all-clear.
                assert!(
                    ext == "json",
                    "capability {} is not JSON; this test would silently ignore it — \
                     convert it or teach capability_files() to parse it",
                    path.display()
                );
                let text = std::fs::read_to_string(&path).expect("read capability");
                let value: serde_json::Value = serde_json::from_str(&text)
                    .unwrap_or_else(|e| panic!("{} is not valid JSON: {e}", path.display()));
                let name = path.strip_prefix(&root).unwrap_or(&path).display().to_string();
                out.extend(normalize_capability_file(&name, value));
            }
        }
        out
    }

    /// Flattens one capability file into its individual capabilities.
    ///
    /// `CapabilityFile` (tauri-utils-2.8.3/src/acl/capability.rs) is an untagged
    /// enum with THREE accepted shapes, all honoured by `tauri_build`:
    ///
    ///   1. a single capability object,
    ///   2. a bare array of capability objects,
    ///   3. a named list, `{"capabilities": [...]}`.
    ///
    /// Handling only shape 1 is not a cosmetic gap. Indexing a non-object
    /// `Value` with a string key hits serde_json's `str::index_into`, which
    /// matches only `Value::Object` and returns `Value::Null` for everything
    /// else — so an array-shaped file yielded an empty permission list, was
    /// silently dropped from the `granting` set, and
    /// `capabilities/second-window.json` written as
    /// `[{"identifier":"second-window","windows":["main"],
    ///    "permissions":["allow-app-commands"]}]`
    /// re-opened the whole hole with both ACL tests still green.
    ///
    /// Anything that is not one of the three shapes panics rather than
    /// returning an empty list: an unrecognised shape must fail this test, not
    /// quietly exempt a file from it.
    fn normalize_capability_file(name: &str, value: serde_json::Value) -> Vec<(String, serde_json::Value)> {
        let list: Vec<serde_json::Value> = match value {
            serde_json::Value::Array(items) => items,
            serde_json::Value::Object(map) => match map.get("capabilities") {
                Some(serde_json::Value::Array(items)) => items.clone(),
                Some(other) => panic!(
                    "{name}: `capabilities` must be an array of capabilities, found {other}"
                ),
                None => vec![serde_json::Value::Object(map)],
            },
            other => panic!(
                "{name}: not a recognised CapabilityFile shape (single object, array, \
                 or {{\"capabilities\": [...]}}), found {other}"
            ),
        };
        let single = list.len() == 1;
        list.into_iter()
            .enumerate()
            .map(|(i, cap)| {
                assert!(
                    cap.is_object(),
                    "{name}[{i}]: a capability must be an object, found {cap}"
                );
                // Label each entry so a failure names the exact capability, not
                // just the file it came from.
                let label = if single {
                    name.to_string()
                } else {
                    format!("{name}[{i}]")
                };
                (label, cap)
            })
            .collect()
    }

    /// The permission identifiers a capability grants. An identifier with no
    /// `prefix:` targets `APP_ACL_KEY`, i.e. this app's own commands
    /// (tauri-utils `Identifier::get_prefix` / `resolved.rs`'s `APP_ACL_KEY`
    /// arm); anything with a prefix is a plugin and not our concern here.
    ///
    /// `cap` is guaranteed to be an object by `normalize_capability_file`, so
    /// the indexing below cannot silently degrade to `Value::Null` the way it
    /// did when a whole file was passed in.
    fn app_permission_ids(cap: &serde_json::Value) -> Vec<String> {
        let permissions = cap["permissions"].as_array().unwrap_or_else(|| {
            panic!(
                "capability {} has no `permissions` array; tauri requires one, and \
                 treating it as \"grants nothing\" would exempt it from this test",
                cap["identifier"]
            )
        });
        permissions
            .iter()
            .filter_map(|p| {
                // A capability entry is either a bare identifier string or an
                // object that extends the scope of one.
                p.as_str()
                    .or_else(|| p.get("identifier").and_then(|i| i.as_str()))
            })
            .filter(|id| !id.contains(':'))
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
        // Same sanity check on the other side. `split_once(']')` truncates on
        // the first `]` in the array — a future inline comment containing one
        // would silently shorten this list, and a truncated list passes the
        // `missing` assert below before it fails the `stale` one.
        assert!(
            allowed.len() > 40,
            "TOML extraction is broken, not the handler list: parsed only {} commands",
            allowed.len()
        );

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
        //
        // Checking `capabilities/app-commands.json` alone is NOT enough, which
        // is why this walks the whole directory. `resolve_access` UNIONS the
        // resolved commands across every capability
        // (tauri-utils `Resolved::resolve` pushes one `ResolvedCommand` per
        // capability into the same `allowed_commands` entry, and
        // `resolve_access` returns a match if *any* of them matches). So a
        // future `capabilities/second-window.json` that copies `default.json`'s
        // `{"windows": ["main"], "permissions": ["allow-app-commands"]}` shape
        // re-opens exactly the hole this whole change closed, while a test that
        // only reads app-commands.json still passes.
        let caps = capability_files();
        assert!(
            !caps.is_empty(),
            "extraction is broken, not the capabilities: found no capability files"
        );

        let granting: Vec<_> = caps
            .iter()
            .filter(|(_, cap)| !app_permission_ids(cap).is_empty())
            .collect();
        let names: Vec<&str> = granting.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(
            granting.len(),
            1,
            "app commands must be granted by exactly ONE capability so this test can \
             reason about the whole grant; found {names:?}"
        );

        let (name, cap) = granting[0];
        assert_eq!(
            app_permission_ids(cap),
            vec!["allow-app-commands".to_string()],
            "{name} grants an app permission other than the one the manifest defines"
        );
        assert_eq!(
            cap["webviews"],
            serde_json::json!(["main"]),
            "{name} must be webview-scoped"
        );
        assert!(
            cap.get("windows").is_none(),
            "{name}: a `windows` entry would also match the browser-tile child webview, \
             because resolve_access matches windows OR webviews"
        );
        assert_eq!(cap["local"], serde_json::json!(true), "{name}");
        assert!(
            cap.get("remote").is_none(),
            "{name}: granting a remote origin would undo the whole fix"
        );
    }
}
