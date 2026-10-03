# Stability audits

## 2026-10-03 — intermittent “Not Responding” in 0.9.21

Reported symptoms: startup, opening Settings, and general use freeze; the app
usually recovers. Reviewed the native setup path, registered IPC commands,
Settings mount effects, persistence, background polling, and the installed
app's crash log. No live hang was captured, so the findings below identify
confirmed blocking paths rather than prove which operation caused a particular
reported freeze.

### Ranked findings and fixes

1. **High: background network requests blocked the window thread.**
   `App.tsx:617` starts notification polling on mount and every 60 seconds;
   the adjacent effect also fetches the staff role. Both reached synchronous
   native commands (`marketplace_notifications`, `marketplace_staff_whoami`).
   With a stored session, these perform HTTPS requests with a 10-second
   timeout. Many community, account, and staff commands had the same defect.
   A rejected Promise in the UI cannot keep the native event loop responsive
   while that work runs. All 38 remaining synchronous marketplace commands
   now dispatch their original bodies through `spawn_blocking`, awaited from
   async IPC entry points. Command names, payloads, validation, and network
   timeout rules are preserved. See `app/src-tauri/src/marketplace.rs`.
2. **High: opening Settings enumerated audio devices on the window thread.**
   `SettingsWindow` mounts `useAudioSource`, which immediately invokes
   `audio_sources_list`. On Windows this calls `mixer::sessions_snapshot`,
   including COM device/session enumeration and process/icon lookups. The
   command now performs that work on a blocking worker. See
   `app/src-tauri/src/audio_source.rs:140` and `app/src/state/useAudioSource.ts`.
3. **Medium: routine persistence and content reads blocked the window thread.**
   `tweaks_save` serializes the complete settings object, writes a temp file,
   and calls `sync_all` before renaming it. Settings hydration, credential
   access, preset scans/reads, tile/visualizer reads, visualizer writes, and
   crash-log path creation also performed synchronous disk/platform work.
   These IPC commands now dispatch to blocking workers. Import/export already
   used async commands but held async executor threads during native dialogs
   and file I/O; their complete bodies now run on blocking workers too.
   Mutexes protect settings/visualizer temp files and the entire credential
   store read/modify/write transaction against concurrent workers. The existing
   frontend save queue still preserves settings-save order. See `tweaks.rs`,
   `secrets.rs`, `presets.rs`, `tiles.rs`, `visualizers.rs`, and `crash_log.rs`
   under `app/src-tauri/src`.
4. **Separate runtime issue: recorded WebView2 GPU-process exits.**
   The installed app's `%APPDATA%/com.secondmonitor.hub/crash.log` records
   `kind=6`, `reason=3`, `exit_code=34` at 2026-09-30 22:39:51 UTC and
   2026-10-01 07:29:56 UTC. The latter event appears for both webviews, which
   does not establish two distinct GPU crashes. Microsoft identifies kind 6
   as `GpuProcessExited` and documents automatic recovery. These entries
   establish a separate graphics/runtime failure, not its cause or its
   connection to the reported hangs. No driver changes, GPU-disabling flags,
   or speculative renderer recovery changes were made.

Tauri documents the command scheduling behavior in
[Calling Rust from the frontend](https://v2.tauri.app/develop/calling-rust/).
Microsoft documents shared GPU failure events and recovery in
[WebView2 process events](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-related-events).

### Remaining audit observations

- `spotify::spawn` (`spotify.rs:117`) and `discord::spawn`
  (`discord.rs:363`) still read small credential files during native setup.
  Moving these requires preserving initialization order for early status and
  client-ID requests; it is a lower-priority startup follow-up.
- `useTweaks.ts` serializes saves but retains every debounced snapshot if the
  disk remains slow. Coalescing waiting snapshots would bound that backlog.
- Clipboard/URL-launch operations and foreground-window metadata queries
  remain synchronous OS calls. Flags, cached state, and mixer worker messages
  also remain synchronous. They are explicitly inventoried in
  `command_thread_tests.rs`; the inventory is not a claim that OS calls can
  never stall.
- No startup-time comparison, Settings interaction trace, or extended native
  playback test was performed. The GPU failures still need a reproduction
  with the runtime/driver versions and workload recorded.

### Validation

- 203 Rust library tests passed, including new regression checks that reject
  unreviewed synchronous commands and require marketplace commands to dispatch
  their blocking work to workers.
- 1,377 frontend tests passed.
- TypeScript/Vite production build passed with the existing large-chunk warning.
- Windows release build passed (`npm run tauri -- build --no-bundle`), producing
  `app/src-tauri/target/release/second-monitor-hub.exe`.
- Existing Rust dead-code warnings remain in audio-source, Discord, and
  marketplace helpers.
- The local test executable was launched for user testing. The installed app
  was not replaced during the audit.

### Release verification — 0.9.22

Published 2026-10-03 after [PR #14](https://github.com/Bigollie8/2ndmonitor/pull/14)
merged into `main` as `c0205d2`; tag `v0.9.22` points to that commit.

- The [macOS PR check](https://github.com/Bigollie8/2ndmonitor/actions/runs/37146826401)
  passed: frontend checks, 205 Rust tests passed and one ignored. The check on
  the merged `main` commit also passed. All 21 release-script tests passed locally.
- The [release workflow](https://github.com/Bigollie8/2ndmonitor/actions/runs/37147168053)
  built both Windows and universal macOS installers and generated the combined
  updater manifest. Its final mirror step failed because `RELEASES_TOKEN` is
  absent; the public mirror was completed with the authenticated maintainer CLI.
- Both updater artifact signatures and their trusted comments verified against
  the public key pinned in `tauri.conf.json`. The manifest includes Windows,
  Apple Silicon, Intel, and universal entries with correct public URLs and notes.
- All six artifacts were uploaded to a public-repository draft, downloaded again,
  and compared byte-for-byte before publishing as latest. Anonymous downloads
  after publication also returned HTTP 200 and matched every source artifact.
  The anonymous latest updater endpoint returns version `0.9.22`.

| Artifact | SHA-256 |
|---|---|
| Windows setup EXE | `b03e8fdfd006fc56a12f998907bea38cb84afda1645fd9d86b99ad47a0439962` |
| Universal DMG | `1129d88b8508415bd7702d5dfc20298a1035d298cbc5d169d24f04771abada2f` |
| Universal updater archive | `3230de7baa4d05a0929342c8c11959e4370e91be3a5f2bd7a033b9e72f2cea90` |
| Updater manifest | `9591c29ca8791267d8a07441332a3b9ed0c20fc805611db3ed09e287f9408cb8` |

[Public release and downloads](https://github.com/Bigollie8/2ndmonitor-releases/releases/tag/v0.9.22).

### Native verification to complete

Fully quit any existing instance through the tray menu before trying the new
build, since launching a second instance only activates the existing process.
Compare three launches with the same settings/content, repeatedly open and close
Settings while playing audio/video, and leave the dashboard open across several
notification polls. Repeat with the marketplace unavailable to verify slow
requests leave the window interactive. Check the crash log for new GPU failures.

---

## Historical audit — 0.9.14 (2026-08-21)

The historical “no sync blocking commands” conclusion below does not describe
the current code; the October audit above supersedes it.

Scope: the request was "random crashes" with no repro plus a general stability
pass. The deliverable is ordered by risk, ties each item to files/lines, and
separates what was fixed in 0.9.14 from what is recommended.

## Fixed in 0.9.14

| # | Risk | Where | Fix |
|---|------|-------|-----|
| 1 | **No root React error boundary** — a throw in any surface except Marketplace unmounted the whole tree (the "window goes black" report). | `app/src/main.tsx`; previously only `App.tsx:~2017` guarded Marketplace | `<ErrorBoundary surface="2ndMonitor" allowReload>` around `<App/>`: the failure shows surface + stack + Reload instead of black. |
| 2 | **No per-tile boundary** — one tile's render/effect throw blanked the dashboard. | `App.tsx` tile render loop | `<ErrorBoundary inline>` around every `renderTile(instance)`; a broken tile shows its error + Try again inside its own frame. |
| 3 | **Rust panics invisible** — no `set_hook`; a panic on a command thread or worker exited with nothing to send. | `app/src-tauri/src/crash_log.rs` (new), installed in `lib.rs` setup | Panic hook appends `[iso-time] panic in thread 'x' at file:line:col: msg` to `<app-data>/crash.log` (capped at 512 KB, oldest half dropped), then chains to the default hook. `crash_log_path` command + Settings → Advanced → Crash log row with Copy-path. |
| 4 | Idle visualizer motion snapped (hard on/off beat gates) | `viz.tsx` `makeSpectrumReader` fallback branch | Continuous attack/decay envelopes; live-audio branch untouched. |

## Audited clean (no change needed)

| Area | What was checked | Finding |
|------|------------------|---------|
| `unwrap()` / `expect()` (130+ sites) | Every site in `tiles.rs`, `marketplace.rs`, `visualizers.rs`, `presets.rs`, `audio_source.rs`, `sandbox.rs`, `claude.rs`, `lib.rs` | **All but one are inside `#[cfg(test)]` modules** (fixtures: `fs::write(...).unwrap()`, `serde_json::from_str(...).unwrap()`, etc.). Production paths use `?` / `ok_or` / `unwrap_or_default`. The one production `expect` is `sandbox.rs:200` building a static HTTP response from constants — unreachable at runtime. The `panic!` calls in `lib.rs:330–420` are the ACL test helpers. |
| Event-listener effects (`listen(...)`) | `App.tsx` (×2), `useVizStyles.ts`, `viz-scripted.tsx`, `tauri.ts` (×4), `useAudioSource.ts`, `useTileCatalog.ts` | Every site uses the `cancelled` flag + stored `unlisten` + cleanup pattern from the 0.9.5 leak audit, including the "`listen()` resolved after unmount" race. `tauri.ts:87–96` (sysmon) is a deliberate module-level ref-counted subscription with `sysmonStop`. |
| Timers / rAF | `useAnimateGate`, `paceFrame`, sandbox frame pump, Claude/tile pollers | All cleared in effect cleanup; draw loops skip work when `isWindowHidden()`; the viz is fully paused in capped perf modes when nothing plays and in edit mode (0.9.12). |
| WebGL contexts | Gallery, sandbox surfaces, Shader Lab | Contexts live inside sandbox iframes (one per mounted surface) and are released when the iframe unmounts; gallery bundle cards are static (no live surface), so the ~16-context cap is not approached. |
| UI-thread hangs | Tauri commands | Blocking work (ureq, WMI, fs, zip) runs via `spawn_blocking` / worker threads since the 0.8.7 audit; no sync blocking commands were found. |

## Recommended (not auto-fixed — needs design or hardware)

| # | Risk | Where | Recommendation |
|---|------|-------|----------------|
| R1 | A panic still kills the thread it happens on; a worker that panics (audio supervisor, Claude scanner) stays dead until restart. | `audio.rs`, `claude.rs`, `sysmon.rs` workers | Wrap each worker loop body in `catch_unwind` and restart with backoff (log via the hook). Deferred: needs per-worker state-reset design. |
| R2 | Unbounded network retry in `usePoll` users on persistent failure. | `state/usePoll.ts` consumers | `usePoll` already backs off on thrown errors; verify ceiling per poller; acceptable today. |
| R3 | `DeclarativeTile` view.json from third-party bundles drives rendering. | `components/DeclarativeTile.tsx`, `sandbox/template.ts` | Already validated by `validateViewSpec` (tests cover shape/URL/interval caps); keep adding fixtures for new directives. |
| R4 | Rust host CPU ~50% while music plays (0.9.13 measurement) | `audio.rs` FFT + per-frame IPC | Not a stability risk; a perf follow-up (batch IPC / lower emit Hz when no viz is live). |

## How to report a crash now

1. Settings → Advanced → **Crash log** → Copy path.
2. Attach `crash.log` (and a screenshot of the in-app error panel if one showed).
3. Tile errors show the surface name in the panel; the same message is in the log.
