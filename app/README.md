# Second-Monitor Hub

Tauri 2 + React + TypeScript + Vite implementation of the design prototype at `../index.html`.

## Run

```sh
cd app
npm install            # first time only
npm run tauri:dev      # dev build with hot-reload
```

The dev command boots Vite on `localhost:1420` and launches the native Tauri window pointed at it. Edits to `src/**` hot-reload in the window; edits to `src-tauri/src/**` trigger a Rust rebuild.

## Build a release binary

```sh
npm run tauri:build
```

Produces a single `.exe` in `src-tauri/target/release/`. The bundle (installer/MSI) is currently disabled in `tauri.conf.json` — turn `bundle.active` to `true` and add icons to `src-tauri/icons/` to ship installers.

## Project layout

```
app/
  index.html               Vite entry
  src/
    main.tsx               React root
    App.tsx                Hub layout (top chrome + grid + bottom strip + overlays)
    types.ts               Shared types
    data.ts                TRACKS, ACCENT_PALETTES, density specs
    state/
      tauri.ts             useSysmon — listens to `sysmon:tick` events
      useTweaks.ts         localStorage-backed tweaks (mode/accent/density)
    components/
      viz.tsx              5 viz modes + viz hero + overlay
      tiles.tsx            HFTile chrome + 8 tile types + Sparkline
      edit.tsx             Edit mode overlay (toolbar, handles, props panel, layers)
      profile.tsx          Profile switcher + ProfilePreview SVG
      onboarding.tsx       5-step first-launch wizard
      tweaks.tsx           Floating dev panel (vizMode/accent/density)
  src-tauri/
    Cargo.toml             Rust deps: tauri 2, sysinfo, parking_lot
    tauri.conf.json        Window + build config
    capabilities/          Tauri 2 permissions
    src/
      main.rs              Console-hide shim for release
      lib.rs               tauri::Builder + setup hook
      sysmon.rs            1Hz sysmon sampler thread; emits `sysmon:tick`
```

## Status (v0.1)

**Working**
- Full Layout C UI: top chrome, 5-tile rail, viz hero with all 5 animated modes, sysmon/clock/upnext bottom strip, edit mode, profile switcher, onboarding wizard.
- **Real CPU + RAM** sampling at 1Hz from the Rust backend via `sysmon:tick` events; sparklines update live.
- Theme-linked accent (re-themes on track pick).
- Tweaks persisted to `localStorage`.
- Keyboard: `⌘E` edit mode · `⌘1/2/3` profile · `V` cycle viz · `Esc` close overlay.

**Mocked / deferred**
- **GPU + Net** sysmon: shape is wired (sparkline + cells) but currently emits 0 from Rust. Real GPU needs NVML / ADL; network needs Win32 perf counters.
- **Audio visualizer**: still uses synthetic `Math.sin` envelopes from the prototype. Real WASAPI loopback + `rustfft` is the next big chunk (PRD §6.3).
- **SQLite persistence**: localStorage covers v0.1 needs. Add `tauri-plugin-sql` when persisting layouts/presets.
- **Native app reparenting** (PRD §6.2 native tiles): Phase 2.
