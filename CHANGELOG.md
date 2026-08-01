# Changelog

All notable changes to 2ndMonitor are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versions follow semver.

## [Unreleased]

## [0.5.0] - 2026-08-01

### Added
- Marketplace: browse, install, remove, and rate community visualizers and tiles
  from inside the app — signed index, per-bundle permissions shown before
  install, star ratings with sign-in, and one-click restore of removed content
- Preview images on every marketplace card, generated from each visualizer's
  real render; hovering an installed visualizer's card plays it live
- MilkDrop visualizer: the classic preset engine (Butterchurn) with the full
  preset pack, plus your own `.milk` presets from the app data `presets/` folder
- Scripted visualizers: write your own visualizer in JavaScript with a live
  in-app editor — code runs in a locked-down sandbox with a small `viz` API
- 27 visualizer styles and 10 tiles now ship as marketplace bundles, so they
  update independently of app releases
- Settings window with searchable Tile Library (replaces the dev Tweaks panel)
- Settings export/import via native file dialogs
- System tray with close-to-tray (toggle in Settings, default on)
- Encrypted secret store and shared polling infrastructure

### Changed
- Built-in visualizer styles and five built-in tiles migrated to marketplace
  bundles; existing layouts keep working through automatic id migration
- Faster startup: tiles, viz gallery, and the extra visualizer styles now lazy-load
- Fonts are self-hosted as 2 variable-weight files (no external font hosts)

### Security
- Tauri command ACL now ships a real manifest scoped to the main window, so
  embedded browser pages can no longer reach app commands
- The visualizer sandbox is served from its own origin with a header-delivered
  CSP and a per-process proof token; sandboxed code has no network or IPC
  access beyond its declared, brokered permissions

### Fixed
- Opening the marketplace no longer mounts a grid of live sandboxes at once —
  cards show images and animate only on hover (this was the marketplace-open
  lag/near-crash)
- MilkDrop presets now load in packaged builds. Butterchurn compiles preset
  equations with `new Function`, which the app CSP (`script-src 'self'`)
  rightly blocks in the main window; the visualizer now runs inside the
  eval-capable viz sandbox iframe, so downloaded presets also stop executing
  with app privileges. (`tauri dev` injects no CSP, which is why this never
  reproduced in development.)
- Visualizer frame pacing no longer fights 144 Hz vsync; the render loop pauses while hidden to tray
- Clicking the tray icon restores a minimized window; second launches refocus the running instance
- Settings import merges over current values (not defaults) and surfaces errors in the UI

## [0.4.0] - 2026-05-08

### Added
- Source-aware Now Playing tile that follows whichever player is active
- Apple Music integration

## [0.3.3] - 2026-05-08

### Added
- 16 new tiles

## [0.3.2] - 2026-05-08

### Added
- Stream Deck v2 actions and a Discord toggle
- 7 new tiles
- Streaming-browser launchpad in the visualizer (replaces the YouTube embed)

### Fixed
- Tile-edit interactivity, radar layout, and picker contrast

## [0.3.1] - 2026-05-08

### Fixed
- New tiles now fill their grid rect

## [0.3.0] - 2026-05-07

First tagged release — the foundation.

### Added
- Tile dashboard with drag/resize edit mode and persisted layouts
- Profile system: switcher, create/edit/delete, live layout previews
- Spotify integration: OAuth, Up Next queue, synced lyrics (LRCLIB) with visualizer overlay
- 22 visualizer styles with a browseable gallery
- Configurable weather location with city search
- Interactive todo list in the Notes tile
- Discord voice-channel commands
- Durable tweaks store in app data
