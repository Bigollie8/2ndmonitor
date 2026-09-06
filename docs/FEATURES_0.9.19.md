# 0.9.19 — hotfix: crash while music plays

## The crash

Four crashes on 2026-09-06 (three on 0.9.17, one on 0.9.18), each 5–12 minutes after launch,
all with exception `0xc0000409` and the same fault offset in `SHCORE.dll`. The app's own crash
log never saw them: they are Windows fail-fasts, not Rust panics. Windows Error Reporting saved a
minidump of the 0.9.18 one (`%LOCALAPPDATA%\CrashDumps\second-monitor-hub.exe.12524.dmp`).

Read with a hand-written Node minidump parser (no debugger is installed on the machine):

- Fail-fast code 7 (`FAST_FAIL_FATAL_APP_EXIT`) with HRESULT `0x80070006` (E_HANDLE, "the handle
  is invalid"), raised on an **anonymous COM thread-pool thread** — not one of the app's named
  threads.
- Stack, oldest to newest: `Windows.Media.MediaControl.dll` (the Global System Media Transport
  Controls client) → `SHCORE` task pool (`SHTaskPoolQueueTask` region) → `rpcrt4`/`combase` call
  → `SHCORE` wil `FAIL_FAST` → `KERNELBASE!RaiseFailFastException`.
- Strings in the dump name the media source: `Spotify.exe` 1.2.98.301. Neither Spotify
  (2026-08-26) nor Windows (KBs of 2026-08-14) had updated that day.

That path is the album-art thumbnail hand-off from the media session to our process. The
`nowplaying.rs` poller fed it twice over: a brand-new `GlobalSystemMediaTransportControlsSessionManager`
via `RequestAsync` on every 2 s poll (each marshalling the current session and its thumbnail
reference across processes), and opening the thumbnail the instant the track key changed — the
moment the source app is still replacing its artwork. A fail-fast cannot be caught, so the fix is
exposure.

## The fix

- `Poller` owns one session manager for the life of the poll thread and drops it only when
  `GetCurrentSession` fails, so the next poll rebuilds it.
- `ThumbnailGate` (pure, unit-tested) opens a track's thumbnail only after the same track key has
  been reported on two consecutive polls, and at most once per track. Rapid skips never open the
  artwork of tracks skipped past. Album art appears ~2 s later than before.
- The poll thread is named `nowplaying-poll` so a future dump attributes it.
- Transport commands (play/pause/skip) keep their one-shot session lookup; they are rare.

This is a mitigation grounded in the dump, not a proof of root cause: the fail-fast is inside
Windows. If it recurs on 0.9.19, the next lever is running the GSMTC client in a helper process so
a fail-fast there cannot take the app down. The separate 12:27 WebView2 crash
(`EmbeddedBrowserWebView.dll` 152.0.4191.66, `0x80000003`) has no dump and is not addressed.

## Validation

- Windows Rust library tests: **197 pass** (193 + 4 `ThumbnailGate` tests). Frontend unchanged
  from 0.9.18 (1366 pass). Root script suite: 33 pass, 1 pre-existing metadata failure.

## Release verification

Published on 2026-09-06:

- Source commits `419b6f6` (fix) and `f73b2b1` (bump); annotated tag `v0.9.19` on the bump commit.
- [macOS check](https://github.com/Bigollie8/2ndmonitor/actions/runs/34047953097) on main passed
  before tagging.
- [Release build](https://github.com/Bigollie8/2ndmonitor/actions/runs/34048069416): Windows and
  universal-macOS legs succeeded, merged `latest.json` attached; the mirror step failed on the
  absent `RELEASES_TOKEN` as before.
- Maintainer fallback: six assets downloaded, both updater signatures verified against the app's
  pinned key (key id `4f5dda4a5dd6cd64`), manifest signatures matched the `.sig` files, staged as a
  draft on [2ndmonitor-releases](https://github.com/Bigollie8/2ndmonitor-releases/releases/tag/v0.9.19),
  re-downloaded and compared by SHA-256 (identical), then published as latest.
- Anonymous `releases/latest/download/latest.json` reports 0.9.19 and is byte-identical to the built
  manifest; anonymous HEAD requests for the Windows setup EXE, universal DMG and universal app
  updater archive returned HTTP 200 with the expected sizes.
- [Announce job](https://github.com/Bigollie8/2ndmonitor/actions/runs/34048069321) posted
  `release v0.9.19` and `spotlight v0.9.19`.
