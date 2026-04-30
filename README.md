# 2nd Monitor Hub

A second-monitor-friendly dashboard for Windows: 27 audio visualizers, real Spotify Up next + LRCLIB lyrics, Discord voice tile, system monitor, weather, todos, and a drag-resize edit mode with per-profile layouts.

## Running it

Requires Node 20+, Rust 1.75+, and Windows (the app uses Windows GSMTC for now-playing + WASAPI loopback for audio capture).

```
cd app
npm install
npm run tauri:dev
```

## Building a release

```
cd app
npm run tauri:build
```

The MSI installer lands at `app/src-tauri/target/release/bundle/msi/`.

## First launch

A 5-step onboarding walks you through audio source, profile, and tile pick. After that:

- **V** — cycle visualizer style
- **Ctrl+E** — toggle edit mode (drag tiles, resize, hide)
- **Ctrl+1 / 2 / 3** — switch profile
- **Esc** — close any overlay
- Top-chrome **↻ Setup** — replay onboarding any time

## Connecting Spotify (optional, requires Premium)

1. Visit `developer.spotify.com/dashboard`, create an app
2. Add `http://127.0.0.1:14202/callback` as a Redirect URI (must be the literal IP — Spotify deprecated `localhost` in 2025)
3. Copy your Client ID, paste it in the Spotify tile's "Up next" tab, click Connect

## Connecting Discord (optional)

Same flow, but `http://localhost:14201/callback` and your Discord application's Client ID. Discord's RPC scopes (`rpc.voice.read`, `rpc.voice.write`) are auto-grantable to your own app.

## Storage

- Tweaks/layout/profiles: `%APPDATA%/com.second-monitor-hub.app/tweaks.json`
- Discord credentials: `%APPDATA%/com.second-monitor-hub.app/discord.json`
- Spotify credentials: `%APPDATA%/com.second-monitor-hub.app/spotify.json`
