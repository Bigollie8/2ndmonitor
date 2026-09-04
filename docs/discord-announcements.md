# Discord announcements — how it works

2ndMonitor publishes to four Discord channels via webhooks. `CHANGELOG.md` is
the source of truth for releases; `scripts/discord-announce.mjs` does all
posting. Set up 2026-07-31.

## Channels & modes

| Channel   | Mode                | Embed                                  | Content policy |
|-----------|---------------------|----------------------------------------|----------------|
| Releases  | `--version`, `--all`| `2ndMonitor vX.Y.Z`, blurple `0x5865f2`| Full changelog section per shipped version. Automated on tag push. |
| Features  | `--feature` ✨ / `--dev` 🔧 | green `0x57f287` / orange `0xfaa61a` | Curated, **long-form** app-feature content: what it does, how to use it, why it matters. Release spotlights (auto, from `### Added`) also land here. |
| Progress  | `--progress` 🚧     | magenta `0xeb459e`, footer `Dev Log`   | Short dev-log updates for ALL workstreams (app, marketplace, visualizer, audits). |
| Info      | `--info` 📘         | blue `0x5bc0de`, footer `2ndMonitor Info` | Evergreen: roadmap, Tips & Tricks series (numbered — continue from the last posted #). |

## Posting

```bash
# always sanity-check wording first
node scripts/discord-announce.mjs --progress --title "..." --body "..." --dry-run
# then drop --dry-run to send

node scripts/discord-announce.mjs --version 0.5.0   # one release + spotlight
node scripts/discord-announce.mjs --all             # re-seed releases channel (oldest first)
```

Ad-hoc modes (`--dev/--progress/--feature/--info`) require `--title` and
`--body`. Exactly one mode per invocation. Descriptions cap at 4096 chars
(auto-truncated with a link to the changelog).

## Release flow

1. Move `[Unreleased]` items in `CHANGELOG.md` into a `## [X.Y.Z] - YYYY-MM-DD`
   section (format is load-bearing — the parser depends on it).
2. Bump version in `app/src-tauri/tauri.conf.json`, `app/package.json`,
   `app/package-lock.json`, `app/src-tauri/Cargo.toml`, and the app package
   entry in `app/src-tauri/Cargo.lock`.
3. Commit, `git tag vX.Y.Z`, push branch and tag.
4. `.github/workflows/announce-release.yml` posts the changelog to the
   releases channel and, if the section has `### Added` or `### Fixed`, a spotlight to the
   features channel. **It fails loudly if the tagged commit lacks the
   changelog section** — no fallback post.
5. Wait for both Windows and macOS release builds and the merged updater
   manifest. The build workflow reads the same tagged changelog through
   `scripts/release-notes.mjs` for GitHub descriptions and updater notes.
6. Verify the public mirror at `Bigollie8/2ndmonitor-releases`, including
   anonymous access to `releases/latest/download/latest.json` and every
   platform artifact it names. A successful private upload alone does not
   mean users can install or update.
7. Check the announcement job log for BOTH `posted: release vX.Y.Z` and
   `posted: spotlight vX.Y.Z`. Do not run the local sender as well after
   success: that would duplicate the Discord posts.

### Public mirror fallback

The `RELEASES_TOKEN` Actions secret is required for automatic cross-repo
mirroring. It was absent on the 0.9.15 release; installer builds succeeded
but the mirror step failed. Until a scoped publishing credential is
configured, an authenticated maintainer can finish the existing release:

1. Download every asset from the private versioned release into a fresh
   staging directory, including the generated `latest.json`.
2. Generate notes with `node scripts/release-notes.mjs X.Y.Z` into a file.
3. Create the matching public release with `gh release create`, passing
   `--repo Bigollie8/2ndmonitor-releases` and `--notes-file`; upload all
   staged artifacts. If the public release exists, edit its notes and
   upload only after checking which assets are missing.
4. Compare names and SHA-256 digests between both releases and verify the
   anonymous updater URL. Record that mirroring was completed manually;
   the failed Actions mirror step should not be mistaken for a missing
   public release.

Never print webhook URLs or signing credentials while checking a release.

## Secrets

Webhook URLs are credentials and are **never committed**:

- Local: `.env` at repo root (gitignored) — `DISCORD_RELEASES_WEBHOOK_URL`,
  `DISCORD_FEATURES_WEBHOOK_URL`, `DISCORD_PROGRESS_WEBHOOK_URL`,
  `DISCORD_INFO_WEBHOOK_URL`.
- CI: GitHub Actions secrets (releases + features only — CI never posts
  progress/info). Update with `gh secret set NAME`.
- If a URL leaks: regenerate it in Discord channel settings → update `.env`
  (and `gh secret set` for the first two). Webhook messages can't be edited
  after posting; corrections are new posts.

## Code layout & tests

- `scripts/changelog.mjs` — pure logic: `parseChangelog`, embed builders
  (one per mode), `truncateDescription`, `parseEnvFile`. No I/O.
- `scripts/discord-announce.mjs` — CLI: args, env resolution
  (`process.env` first, then `.env`), fetch. Ad-hoc modes live in the
  `TITLE_BODY_MODES` table — adding a channel = one builder + one table row
  + one env var.
- Tests: `node --test "scripts/**/*.test.mjs"` (bare `node --test scripts/`
  breaks on Node 24+).

## Baseline history (2026-07-31)

- Releases: v0.3.0 → v0.4.0 seeded from backfilled CHANGELOG.md.
- Features: kickoff + 3 detailed showcases (dashboard/tiles, music/viz,
  control/QoL) — app facts verified in code: 36 tile types
  (`app/src/state/layout.ts`), 27 viz styles
  (`app/src/components/viz-styles.ts`), 9 media sources
  (`app/src/state/mediaSource.ts`). Re-verify before quoting.
- Progress: 4 workstream posts (marketplace, MilkDrop viz, v0.5.0, hardening).
- Info: roadmap + Tips & Tricks #1–#3 (shortcuts verified against App.tsx
  keydown handler).

## Open follow-ups

- Getting-started/download post — blocked on choosing a build distribution
  channel (GitHub Releases with Tauri installers would fit the tag workflow).
- Image/GIF support in the script for visualizer showcases.
