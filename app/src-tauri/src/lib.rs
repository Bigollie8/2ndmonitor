mod audio;
mod claude;
mod discord;
mod discord_rpc;
mod lyrics;
mod mixer;
mod nowplaying;
mod spotify;
mod sysmon;
mod tweaks;
mod weather;
mod webtiles;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            discord_rpc::discord_rpc_leave_voice,
            spotify::spotify_status,
            spotify::spotify_connect,
            spotify::spotify_disconnect,
            spotify::spotify_get_client_id,
            tweaks::tweaks_load,
            tweaks::tweaks_save,
            weather::set_weather_location,
            audio::set_audio_emit_hz,
            mixer::mixer_set_master_volume,
            mixer::mixer_set_master_mute,
            mixer::mixer_set_session_volume,
            mixer::mixer_set_session_mute,
            mixer::mixer_set_default_output,
            mixer::mixer_refresh,
        ])
        .setup(|app| {
            sysmon::spawn(app.handle().clone());
            nowplaying::spawn(app.handle().clone());
            lyrics::spawn(app.handle().clone());
            audio::spawn(app.handle().clone());
            mixer::spawn(app.handle().clone());
            claude::spawn(app.handle().clone());
            weather::spawn(app.handle().clone());
            discord::spawn(app.handle().clone());
            discord_rpc::spawn(app.handle().clone());
            spotify::spawn(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
