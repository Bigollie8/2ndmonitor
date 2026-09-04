# Project review — 2026-09-04

Reviewed version: 0.9.15. This is a source review and local test run, not a live UI, hardware, deployment, or exhaustive security audit. No application code was changed.

## Understanding the project

Second-Monitor Hub is a persistent desktop companion: an editable dashboard combined with audio-reactive visuals and native integrations. Its core value is making the spare screen useful while work, games, or music happen elsewhere.

- **Desktop:** React/TypeScript inside Tauri, with Rust handling audio capture and analysis, media sessions, system metrics, window behavior, credentials, and installation. The repository now includes macOS support as well as Windows.
- **Dashboard:** profiles, separate portrait/landscape layouts, multiple tile instances, themes, keyboard controls, setup/profile import and export, and a large integration catalog.
- **Content platform:** bundled and installable visualizers, declarative tiles, MilkDrop presets, sandbox messaging, permission mediation, and signed marketplace content.
- **Service:** an Axum/SQLite marketplace with accounts, submissions, reviews, moderation, community features, and preset backup.

Existing strengths include extracting layout/catalog decisions into testable functions, per-tile error boundaries, signed content verification, OS-backed secret storage, lazy loading many tiles, and explicit performance controls. Improvements should extend these foundations.

## Concrete findings

These are code-level findings; the edge cases below were not reproduced in a packaged app.

### 1. High: a settings-load failure can become settings loss

References: `app/src/state/useTweaks.ts:69–124`, `app/src-tauri/src/tweaks.rs:24–55`.

The persistence effect schedules a write 300 ms after mounting without checking hydration or load success. If `tweaks_load` fails, the hook logs a warning and continues with defaults or the legacy localStorage value. The pending save can then overwrite the original file. A slow hydrate also has a write-before-load race. Under Tauri the legacy copy is no longer updated, so it is not a dependable recovery source.

Make persistence wait for a successful load or a confirmed missing file. Distinguish “loaded,” “missing,” and “failed”; a boolean meaning “settled” is insufficient. Keep a last-known-good backup, preserve unreadable input, and show save/load failures in the UI. Test the hook lifecycle with delayed reads and rejected reads, rather than testing only merge helpers.

### 2. Medium: frontend errors are absent from the advertised crash log

References: `app/src/components/ErrorBoundary.tsx:42–63`, `app/src-tauri/src/crash_log.rs:62–88`.

The tile error panel tells users that details are in the crash log, but `componentDidCatch` only calls `console.error`. The Rust logger records startup markers and Rust panics; there is no frontend error bridge. A user following the instructions can submit a log missing the actual failure.

Add a bounded, sanitized frontend-error logging command, include surface and app version, and provide a Copy diagnostics action. Cover unhandled promise failures separately. Avoid exporting credentials or private tile content.

### 3. Medium: log rotation can itself panic

Reference: `app/src-tauri/src/crash_log.rs:26–34`.

After the log exceeds 512 KiB, rotation slices a UTF-8 string at `text.len() / 2`. That byte offset can land inside a multibyte character in a message or path. Rotation can therefore panic, including while handling another panic.

Rotate on a valid character/newline boundary or handle bytes without slicing a string at an arbitrary offset. Add a multibyte rotation fixture. Also reconcile the old worker-recovery recommendation with `panic = "abort"` in the release profile before designing recovery.

### 4. Medium: unsuccessful registration can consume an invite

References: `server/src/auth.rs:142–168`, `server/src/invites.rs:72–109`.

Registration redeems the invite before inserting the account. If the email already exists, insertion returns a conflict after the invite use has already been committed. A single-use invite is then unusable even though registration failed.

Hash before opening a transaction, then redeem and insert within one transaction. Roll back both on failure. Test a duplicate-email attempt followed by a valid registration using the same invite.

### 5. Low: onboarding location searches can resolve out of order

Reference: `app/src/components/onboarding.tsx:116–126`.

The debounce cancels the timer, but an already-started geocode request can still update results after the query changes. A slower old request can replace results for the latest city name.

Use an effect cancellation/generation check on both success and failure, or abort the previous request. Test reversed response order and clearing the query while a request is in flight.

## Product improvements, in priority order

| Priority | Improvement | Why it fits | Small first version |
|---|---|---|---|
| 1 | Recoverable layout editing | Layouts are personal work; recent release notes already document accidental corruption. | One undo step per completed drag/resize/add/remove, redo, and a last-good profile snapshot. Keep separate histories per profile/orientation. |
| 2 | Connection and data freshness status | Many tiles depend on different accounts, devices, and network services. | A Settings page showing connected/needs setup/error, last successful update, and retry/reconnect. Extend `usePoll` with a success timestamp and show stale-data age on tiles. |
| 3 | Automatic profile switching | Work/Gaming/Chill profiles and foreground-app detection already exist. | Opt-in rules such as “when this game is active, use Gaming,” with debounce and a manual override that temporarily suppresses rules. |
| 4 | Adaptive performance | An always-open companion should have a predictable cost. Existing frame pacing, audio rate controls, and perf HUD provide a foundation. | An Auto mode that adjusts FPS/DPR within explicit limits; show why it stepped down. Measure idle, music, gaming, and tray-hidden behavior before setting thresholds. |
| 5 | Monitor-aware profile recall | The product is explicitly built for spare displays, while layouts currently emphasize orientation. | Remember profile and UI scale for each display, with a safe fallback when a monitor disconnects. Preserve the preferred layout separately from temporary viewport fitting. |
| 6 | Better first-run usefulness | The Work starter includes integrations that may not be configured on a new machine. | Add an audio activity check and simple integration choices; start with useful local tiles and let users opt into integrations requiring setup. |
| 7 | Dependency-aware shared setups | Profile/setup exchange and marketplace layouts already exist. | Preview a layout plus required bundles and connections, distinguish visual arrangement from private config, and guide installation/setup without transporting secrets. |

I would prioritize these over expanding the catalog: each improves the daily experience across many existing tiles.

## Engineering improvements

- **Test lifecycle behavior.** The existing `useTweaks` tests explicitly exercise only pure helpers. Add focused component/hook tests for hydration, cleanup, stale responses, tile recovery, and persistence failure. Retain the pure-function suite.
- **Extend pull-request CI.** CI exists: `macos-check.yml` runs frontend and desktop Rust checks on PRs. Add Windows desktop coverage, marketplace server tests, and the root script tests. Release builds alone do not provide early Windows regression feedback.
- **Split `App.tsx` along behavioral boundaries.** It is 2,690 lines and coordinates persistence/migration, window mode, keyboard handling, profile editing, and tile rendering. Extract these incrementally behind the lifecycle checks above. Avoid a broad rewrite or merely moving large JSX blocks.
- **Unify visibility policy.** `framePace.ts` knows about native tray-hidden state, whereas `usePoll` checks `document.hidden`. The code documents that native hiding does not reliably update document visibility. Share visibility state where appropriate, while allowing integrations that must continue in the background to opt out.
- **Refresh the documentation and audit ledger.** `app/README.md` describes v0.1 mocks and disabled installers; the actual config enables installers. The root README still describes Windows-only support and five onboarding steps; the code includes macOS and four steps. The server README describes implicit dev-email mode, but code requires explicit `DEV_EMAIL`. The deferred ledger still claims no CI and includes previously fixed security issues. Mark resolved entries and separate historical observations from current guarantees.

## Suggested sequence

1. Fix persistence and diagnostics; add regression coverage for their failure paths.
2. Add layout undo/history and a recovery UI.
3. Build connection/freshness status on the shared polling and integration infrastructure.
4. Introduce opt-in profile automation and monitor recall.
5. Tune adaptive performance from measurements on representative hardware.

## Validation

- Frontend: **1,276 tests passed** (`npm test`). The first sandboxed attempt failed in the test runner's Windows user-account lookup; the approved rerun passed.
- TypeScript: **passed** (`node node_modules/typescript/bin/tsc -b --pretty false`).
- Marketplace server: **271 tests passed** (`cargo test --locked --offline`).
- Desktop Rust library: **186 tests passed** (`cargo test --locked --offline --lib`); compiler warnings remain.

Passing tests establish the current baseline, not coverage of the edge cases identified above. This review did not launch the desktop UI, exercise physical audio/display devices, build an installer, test macOS, or contact the live marketplace.
