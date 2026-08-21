# Stability audit — 0.9.14 (2026-08-21)

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
