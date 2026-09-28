# 0.9.21 — Background playback and startup

Released 2026-09-28. Includes Windows WebView2 background scheduling
overrides, moves system initialization and content scans off the window
thread, and fixes the Discord diagnostic-text UTF-8 crash. Investigation
details and native playback checks are in the
[performance follow-up](performance/2026-09-27-background-playback.md).
No measured improvement in startup time or dropped playback frames is claimed.

## Release verification

- Implementation, version and changelog commit: `2685757`; annotated tag
  `v0.9.21` points to that commit.
- Local Windows checks: 201 Rust library tests, 1,377 frontend tests and
  21 release-script tests passed. The implementation also passed the local
  production frontend and native Windows builds before the version bump.
- [macOS check](https://github.com/Bigollie8/2ndmonitor/actions/runs/36376007629)
  passed on the release commit: frontend checks and Rust tests, with 203 Rust
  tests passed and one ignored.
- [Release build](https://github.com/Bigollie8/2ndmonitor/actions/runs/36376021221)
  built and uploaded the Windows and universal macOS installers successfully.
  The combined updater manifest was generated and uploaded. The workflow's
  final mirror step failed because `RELEASES_TOKEN` is still absent.
- Completed the public mirror with the maintainer's authenticated GitHub CLI.
  Verified both updater artifact signatures and their trusted comments against
  the public key pinned in `tauri.conf.json`; checked Windows, Apple Silicon,
  Intel and universal manifest entries, URLs, signatures and release notes.
- Uploaded all six artifacts to a public-repository draft, downloaded them
  again and verified that every SHA-256 matched the source artifacts before
  publishing as latest. Artifact content was unchanged.
- Anonymous updater requests returned HTTP 200 and version **0.9.21**, with
  the manifest byte-identical to the verified source. Anonymous HEAD requests
  returned HTTP 200 and matching sizes for the Windows installer (3,493,847
  bytes), universal DMG (10,374,513 bytes) and macOS updater archive
  (9,524,118 bytes).

| Artifact | SHA-256 |
|---|---|
| Windows setup EXE | `a4259d552b546fad456a2ab9313c3f55fe9941d7d1152ab7d34ff8321b8dc714` |
| Universal DMG | `2b734cf8d12323fecc085352d4f8f1b4dd94562ef6769c7d7644256cbad70f19` |
| Universal app updater archive | `01e1d0c870e68c13cd58dd3afc9ce3345c22711957c47416e55bf4a6ff692990` |
| Updater manifest | `07fdc26d2a2354be9040d7ac4facb972635defcad64ffd827b8dc33b164f758e` |

[Public release and downloads](https://github.com/Bigollie8/2ndmonitor-releases/releases/tag/v0.9.21).
Installers were not installed on the maintainer's machine during publication.
