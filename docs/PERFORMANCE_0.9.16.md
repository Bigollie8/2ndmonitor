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
