# 2nd Monitor Hub

A Windows-native dashboard built for the second screen on your desk. Drop it on the side monitor and you get music with synced lyrics, an audio visualizer that reacts to whatever's playing on your PC, a system-resource readout, weather, todos, and a Discord voice tile — all on a drag-resize grid you can rearrange in seconds.

Built with Tauri 2 (Rust + WebView2) and React. ~10 MB installer, native Windows audio capture, no Electron.

## What it does

- **17 built-in audio visualizers**, plus 12 more from the shop, driven by WASAPI loopback capture — they react to whatever is playing through your default output, including Spotify, YouTube, games, anything. Cycle styles with **V**. Includes **MilkDrop** (classic MilkDrop 2 presets via Butterchurn, WebGL) with 100 bundled presets, auto-cycling, and a preset picker.
- **Code your own visualizer** — the **Scripted** style runs your JavaScript (sandboxed: audio data in, pixels out, no network/app access) with folder hot-reload and a built-in editor. See [docs/scripted-visualizers.md](docs/scripted-visualizers.md).
- **Marketplace** — the Tile Library connects to a marketplace server (defaults to the official self-hosted instance) to browse and install community presets, visualizers, and permission-manifest tiles. Everything is ed25519-signed and checksum-verified; installed tiles get exactly the network/command permissions they declare, shown to you at install. Point it at your own server instead — see [`server/README.md`](server/README.md).
- **Now-playing + lyrics** via Windows GSMTC (no service required) and LRCLIB for line-synced lyrics. Optional Spotify connection unlocks "Up next" queue.
- **Discord voice tile** — see who's in your call, who's speaking, mute/deafen status. Uses Discord's local RPC over WebSocket; you provide your own application ID, no token leaves your machine.
- **System monitor** — CPU/RAM/GPU live, with NVML for per-process GPU% on NVIDIA cards.
- **Audio mixer tile** — master volume, output-device picker, and per-app session control (Windows Core Audio).
- **Weather, todos, clock**.
- **Edit mode** (Ctrl+E): drag, resize, hide tiles. Three saved profiles (Ctrl+1/2/3).
- **Performance modes**: battery (30 fps + low DPR), balanced (60 fps), 120 fps, and uncapped — pick based on whether the second monitor matters more than your laptop battery.

## Install

Download the latest `Second-Monitor Hub_<version>_x64-setup.exe` from [Releases](../../releases) and run it. The installer fetches the WebView2 bootstrapper if you don't already have it.

Requires: Windows 10/11 x64.

## Build from source

```
cd app
npm install
npm run tauri:build
```

Produces an NSIS installer at `app/src-tauri/target/release/bundle/nsis/`.

For dev:

```
cd app
npm run tauri:dev
```

Toolchain: Node 20+, Rust 1.75+, Windows (the app uses Windows-only APIs — GSMTC for now-playing, WASAPI for audio capture, Core Audio for the mixer).

## First launch

A 5-step onboarding walks you through audio source, profile, and tile pick. After that:

- **V** — cycle visualizer style
- **Ctrl+E** — toggle edit mode (drag tiles, resize, hide)
- **Ctrl+1 / 2 / 3** — switch profile
- **Esc** — close any overlay
- Top chrome **↻ Setup** — replay onboarding any time

## Connecting Spotify (optional, requires Premium)

1. Visit [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard), create an app
2. Add `http://127.0.0.1:14202/callback` as a Redirect URI (must be the literal IP — Spotify deprecated `localhost` in 2025)
3. Copy your Client ID, paste it in the Spotify tile's "Up next" tab, click Connect

PKCE flow — no client secret needed, tokens stay on your machine.

## Connecting Discord (optional)

Same flow, but `http://localhost:14201/callback` and your Discord application's Client ID. Discord's RPC scopes (`rpc.voice.read`, `rpc.voice.write`) are auto-grantable to your own app.

## Architecture

```
app/
├── src/                  React frontend (Vite + Tailwind)
│   ├── components/         tiles (viz, lyrics, sysmon, weather, mixer, ...)
│   ├── state/              layout/profiles, lyrics, tauri bridge
│   └── perf/               perf-mode HUD + debug
└── src-tauri/            Rust backend
    └── src/
        ├── audio.rs        WASAPI loopback FFT
        ├── mixer.rs        Core Audio session control
        ├── discord.rs      Discord RPC over WebSocket
        ├── spotify.rs      Spotify Web API + PKCE
        ├── lyrics.rs       LRCLIB client
        └── lib.rs          Tauri commands + GSMTC bridge
```

The frontend never talks to the network directly except through the WebView; everything sensitive (OAuth flows, audio capture, system metrics) runs in Rust.

## Storage

- Tweaks/layout/profiles: `%APPDATA%/com.secondmonitor.hub/tweaks.json`
- Discord credentials: `%APPDATA%/com.secondmonitor.hub/discord.json`
- Spotify credentials: `%APPDATA%/com.secondmonitor.hub/spotify.json`
- MilkDrop presets: `%APPDATA%/com.secondmonitor.hub/presets/` — drop Butterchurn preset `.json` files here (convert `.milk` at butterchurn.app; MilkDrop 3 `.milk2` is not supported)
- Scripted visualizers: `%APPDATA%/com.secondmonitor.hub/visualizers/<id>/` (manifest.json + main.js)
- Marketplace server: defaults to `https://market.basedsecurity.net` with its signing key pinned in the app. A custom server (set via "Change server" in the Marketplace tab) overrides it in browser localStorage (`marketplace.url`, `marketplace.pubkey`).

Credentials are stored locally. The app makes no backend calls of its own except to the marketplace server — and only when you open the Marketplace tab or install from it.

## Contributing

Issues and PRs welcome. The codebase prefers small, focused commits — the recent history is a good guide for tone.

## License

[MIT](LICENSE).
