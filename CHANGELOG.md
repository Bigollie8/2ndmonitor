# Changelog

All notable changes to 2ndMonitor are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versions follow semver.

## [Unreleased]

### Added
- Settings window with searchable Tile Library (replaces the dev Tweaks panel)
- Settings export/import via native file dialogs
- System tray with close-to-tray (toggle in Settings, default on)
- Encrypted secret store and shared polling infrastructure

### Changed
- Faster startup: tiles, viz gallery, and the 22 extra visualizer styles now lazy-load
- Fonts are self-hosted as 2 variable-weight files (no external font hosts)

### Fixed
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
