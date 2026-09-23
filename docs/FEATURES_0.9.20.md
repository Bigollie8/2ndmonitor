# 0.9.20 — Auto-fit, visualizer pacing and crash diagnostics

Released 2026-09-23. Changes and limits are documented in the
[performance audit](performance/2026-09-19-audit.md) and the 0.9.20 changelog.
The overnight Netflix crash is not claimed resolved; this release improves
native failure capture and preserves the 0.9.19 GSMTC mitigation.

## Release verification

- Implementation: `7504095`; version/changelog commit and annotated `v0.9.20`
  tag: `f652730`.
- [macOS check](https://github.com/Bigollie8/2ndmonitor/actions/runs/35879390536)
  passed on the release commit.
- [Release build](https://github.com/Bigollie8/2ndmonitor/actions/runs/35879390623)
  built Windows and universal macOS successfully and published the combined
  updater manifest. The final public-mirror step failed because RELEASES_TOKEN
  remains absent; the overall workflow therefore reports failure.
- Completed the mirror manually using the maintainer's authenticated GitHub
  CLI: downloaded all six source assets, verified both updater signatures
  against the public key pinned in tauri.conf.json (artifact and trusted-comment
  signatures), and checked all Windows/Apple Silicon/Intel manifest entries.
- Uploaded to a draft in the public releases repository, re-downloaded all
  six assets and compared SHA-256 hashes with the originals before publishing
  as latest. No asset content was changed.
- Anonymous updater endpoint returned version **0.9.20**. Anonymous HEAD
  requests returned HTTP 200 for the Windows installer (3,492,779 bytes),
  universal DMG (10,361,383 bytes), and universal app updater archive
  (9,506,107 bytes).

Artifact SHA-256:

| Artifact | SHA-256 |
|---|---|
| Windows setup EXE | `bb867460a5f28b1c19ffedd41cee9acbaffd7146109254de9adaf91ac7472ece` |
| Universal app updater archive | `914223bdc8652659fa0dd45feb4359f8d78bb0f4298750624398fb9d16e7af78` |

[Public release and downloads](https://github.com/Bigollie8/2ndmonitor-releases/releases/tag/v0.9.20).
Installers were not installed on the maintainer's machine during publication.
