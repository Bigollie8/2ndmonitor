# Background playback and startup follow-up

Report: 0.9.20 stutters in both the browser player and visualizer when the
window loses focus; launching is slow.

## Findings and changes

- The main view, browser player and web tiles had no background scheduling
  overrides. `webview_policy.rs` now sets process-local WebView2 arguments
  before Tauri starts: `--disable-renderer-backgrounding`,
  `--disable-background-timer-throttling`, and
  `--disable-backgrounding-occluded-windows`. All views receive the same
  environment options. Existing diagnostic arguments and wry defaults are
  preserved. There are no machine-wide settings or priority-class changes.
- `sysmon::spawn` constructed sysinfo, enumerated network interfaces and
  initialized NVML on the setup thread. All initialization now runs inside
  its existing sampler worker. The existing sampling cadence is retained.
- `seed_sync`, `visualizers_list` and `tiles_list` were synchronous Tauri
  commands. Filesystem scans and seed extraction now run on blocking workers
  awaited by async commands, allowing the native event loop to keep running.
  Seed validation, version checks and user removals are retained.
- The installed app's crash log also contained a 2026-09-25 panic in
  `discord_rpc.rs`: truncating at byte 600 split a UTF-8 variation selector.
  Discord payload tracing is now development-only; its truncation respects
  character boundaries. Tests reproduce the logged boundary and cover
  multibyte text and short payloads.

## Evidence and limits

These are code fixes and a background scheduling mitigation, not a measured
before/after performance result. A read-only snapshot of the installed
0.9.20 process tree showed both renderers at Normal priority and no new
scheduling switches. That snapshot does not demonstrate priority starvation
or establish which WebView2 mechanism caused the reported stutter. No claim
is made that the latest app commit introduced the scheduling defaults.

Microsoft documents the timer switch in
[WebView2 browser flags](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/webview-features-flags).
Chromium's maintainers describe renderer priority and occlusion switches in
[Chrome flags for tools](https://github.com/GoogleChrome/chrome-launcher/blob/main/docs/chrome-flags-for-tools.md).
Browser flags depend on the installed engine and require native playback
verification. Disabling browser throttling can increase background work for
embedded pages. The app's own silence caps and explicit tray-hide gates are
retained.

Validation: 201 Rust library tests and 1,377 frontend tests pass. Production
TypeScript/Vite build passes with the existing chunk-size warning.
`npm run tauri -- build --no-bundle` also passes, producing
`app/src-tauri/target/release/second-monitor-hub.exe`. The Rust build reports
existing unused-function warnings in audio_source, discord and marketplace.

The installed app was left running. The changed build has not been installed,
and actual startup times, dropped video frames and sustained background
visualizer cadence have not yet been measured.

## Native verification

1. Fully quit the existing app through its tray menu before launching the
   changed build; a second instance only activates the already-running one.
2. Compare time to an interactive layout on three launches with the same
   installed content and settings, including the first launch after upgrade.
3. Play a browser video while repeatedly moving focus to another application.
   Check picture and audio on the second monitor, then repeat with a live
   visualizer and the same FPS cap and audio source.
4. Open and close Settings over the player. Audio and the existing session
   should survive. Also test minimize/restore and hide-to-tray/restore.
5. Check silence staging and tray hiding still reduce the visualizer's work.
   Capture the existing perf session export for the visualizer; it does not
   measure the browser player's decoded or dropped video frames.
