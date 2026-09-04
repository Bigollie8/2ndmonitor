# 0.9.16 performance changes

This release reduces redundant decorative painting, background polling,
audio allocations, audio-buffer copying, and per-frame geometry reads.
Visualizer frame messages, FFT size, spectrum tuning, stereo ordering, and
the existing user-selected performance modes retain their contracts.

## Evidence

- A deterministic 144 Hz display / 30 Hz audio simulation paints each
  audio frame at most once and verifies idle settling and lower custom caps.
- Poll-loop tests exercise native hide/resume, a hidden initial mount,
  cleanup, late responses, exponential backoff, and recovery.
- Rust regressions compare circular storage with a linear reference across
  wraparound, oversized packets, torn frames, and silence. Existing Windows
  and macOS capture tests use the same new storage. Reused FFT scratch is
  compared directly against the previous transform API over multiple inputs.
- `scripts/bench-audio-ring.rs` compiles the production ring implementation.
  In a local optimized run of 30,000 stereo packets, vector front-draining
  took **39.8649 ms**, versus **1.9238 ms** for batched circular storage.
  Final samples were identical and the circular buffer did not grow.
  This measures storage operations only; it is not a whole-app CPU claim.

## Background policy

| Work | Visible | Hidden in tray | Resume |
|---|---|---|---|
| System metrics | 1 second | 5 seconds | Within the next worker tick |
| Content directory scans | 10 seconds; 2 seconds in Scripted authoring | 30 seconds | Within the next worker tick |
| Shared data-tile polling | Existing per-tile interval/backoff | Deferred | One catch-up if overdue |

Installs, removals, and editor saves increment a content revision, requesting
a scan on the next worker tick rather than waiting for the slower interval.
The capture supervisor remains active to detect audio-device/source changes.

## Validation and limits

- 1,283 frontend tests passed.
- 193 Windows desktop Rust library tests passed.
- 21 changelog/release-note tests passed; dry-run payloads include both
  Discord release and features-channel spotlight messages for 0.9.16.
- TypeScript and production frontend builds passed. An isolated Windows
  Tauri debug build completed successfully.
- The full root script suite has a pre-existing metadata failure: six
  entries in `bundles/metadata.json` use `meter`, which neither its validator
  nor the server category schema accepts. No metadata or server schema was
  changed in this performance release.
- Windows UI automation was unavailable (the native Computer Use pipe was
  absent on both attempts). No live UI/audio-device smoke check or whole-app
  before/after CPU measurement is claimed. macOS validation runs in GitHub CI.

The Windows test build used a separate identifier
`com.secondmonitor.hub.perf0916`; it was not installed or launched over the
user's saved dashboard.

## Published release verification

- Source commit: `fb39c8c4bbb7f0d4030092e7ab91e5e58b32a2c9`, tag `v0.9.16`.
- [macOS CI](https://github.com/Bigollie8/2ndmonitor/actions/runs/33915711810)
  passed, including 195 Rust tests; one hardware-only test was ignored.
- Both platform builds in [Release build](https://github.com/Bigollie8/2ndmonitor/actions/runs/33916220617)
  succeeded. The merged manifest was generated successfully. The missing
  `RELEASES_TOKEN` caused only the public-mirror step to fail, so mirroring
  was completed manually through the authenticated maintainer account.
- The public release was staged as a draft. All six assets matched the
  private release's SHA-256 digests and sizes before publication. Both updater
  package signatures verified against the app's pinned key using the same
  `minisign-verify` version and verification call as the updater.
- After publication, anonymous requests returned version `0.9.16` from the
  latest updater endpoint and HTTP 200 for Windows NSIS, universal macOS DMG,
  and the macOS updater archive. All four platform entries and the full
  changelog notes were checked.
- [Announce release](https://github.com/Bigollie8/2ndmonitor/actions/runs/33916220511)
  succeeded and logged both `posted: release v0.9.16` and
  `posted: spotlight v0.9.16`. No duplicate local webhook posts were sent.
- Public downloads: [2ndMonitor v0.9.16](https://github.com/Bigollie8/2ndmonitor-releases/releases/tag/v0.9.16).
