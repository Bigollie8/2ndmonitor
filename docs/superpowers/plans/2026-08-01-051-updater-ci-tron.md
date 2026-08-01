# 0.5.1: Auto-updater, Release CI, Quote Fix, Tron Port — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 0.5.1 is the last release users install by hand — it adds a signed auto-updater fed by CI-published GitHub Releases, merges the stranded quote-proxy fix, and ships the Tron original presets ported onto the sandbox-era preset model.

**Architecture:** (1) `tauri-plugin-updater` with a minisign keypair; endpoint is the standard `releases/latest/download/latest.json` on GitHub. (2) A `release-build.yml` workflow on `v*` tags uses `tauri-action` on `windows-latest` to build, sign, and publish the Release — nothing publishes until a tag is pushed. (3) Tron originals become a third preset source (`'original'`) whose objects travel the existing `{preset: object}` load path — no new frame-side machinery.

**Tech Stack:** Tauri 2, tauri-plugin-updater 2, tauri-action, React 18 + TS, node:test via tsx.

## Global Constraints

- **Work in `C:\Users\bigol\Documents\Projects\2ndmonitor-051` (branch `feat/0.5.1`)** — never the main checkout.
- The updater private key + password go ONLY to: the user's password vault (they must store it), and GitHub Actions secrets (`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`). Never committed, never in memory files, never echoed to the transcript beyond confirmation of existence.
- The tron branch's `e37e444` (window-CSP `unsafe-eval`) must NOT be merged or reproduced — MilkDrop runs in the eval-capable sandbox since 0.5.0.
- Frontend tests: `npm test` from `app/`; pure-decision extraction pattern (no React harness).
- Nothing merges to main / gets tagged in this plan — the user decides when 0.5.1 ships.

---

### Task 1: Merge the quote-proxy fix

**Files:** merge of `claude/wizardly-wiles-8d0daa` (one commit `f318e78`: proxies zenquotes through Rust to bypass CORS).

- [x] **Step 1 — RESOLVED: fix is obsolete.** Merge attempted 2026-08-01: `quote.ts` was deleted by the 0.5.0 tile migration; `tile-quote` declares `net:zenquotes.io` and fetches through broker_fetch (Rust-side, no CORS), so the proxy the branch adds already exists structurally. Branch left intact for the record; safe to delete in a cleanup sweep. Original: `git merge claude/wizardly-wiles-8d0daa --no-edit`. If it conflicts with 0.5.0's tile migration (QuoteTile was retired into a bundle — the fix may target the retired built-in), inspect: if the fix's target file was deleted by migration, port the proxy into the bundle's fetch path or drop with a note; the bundle `tile-quote` uses `net:zenquotes.io` via broker_fetch which is NOT CORS-bound (Rust-side fetch) — in that case the fix is obsolete: skip the merge, document why, delete nothing.
- [ ] **Step 2:** `npx tsc -b && npm test` from `app/` — green.
- [ ] **Step 3:** Commit (the merge itself, or a `docs:` note recording obsolescence).

### Task 2: Auto-updater

**Files:**
- Modify: `app/src-tauri/Cargo.toml` (+`tauri-plugin-updater = "2"`), `app/src-tauri/src/lib.rs` (register plugin), `app/src-tauri/tauri.conf.json` (updater plugin config: pubkey + endpoint + `createUpdaterArtifacts: true` under bundle), `app/src-tauri/capabilities/*.json` (grant `updater:default` to main window), `app/package.json` (+`@tauri-apps/plugin-updater`)
- Create: `app/src/state/updater.ts` (pure decision + effect wrapper), `app/src/state/updater.test.ts`, `app/src/components/UpdateToast.tsx`
- Modify: `app/src/App.tsx` (mount toast), Settings About/System pane (manual "Check for updates" button)

**Interfaces:**
- Produces: `checkForUpdate(): Promise<UpdateInfo | null>` (JS plugin wrapper), `shouldPrompt(state: UpdaterState, nowMs: number): boolean` pure gate (throttle: prompt at most once per version per session; snooze 24h persisted in tweaks store).

- [ ] **Step 1:** Generate keypair: `npx tauri signer generate -w <scratchpad>/updater.key` with a generated password; show the user the pubkey; instruct them to vault the private key + password; `gh secret set` both.
- [ ] **Step 2 (TDD):** `updater.test.ts` — `shouldPrompt` cases: first sighting of a version → true; same version again in session → false; snoozed <24h ago → false; snooze expired → true; current version equal → never.
- [ ] **Step 3:** Implement `updater.ts`: plugin `check()` wrapper mapping to `{version, notes, downloadAndInstall}`; snooze persistence via existing tweaks store key `updater.snoozedUntil` + `updater.snoozedVersion`.
- [ ] **Step 4:** `UpdateToast.tsx`: small bottom-right card in app visual language (dark panel, hairline border, accent button): "v0.5.2 available" + [Update & restart] [Later]. Update button: `downloadAndInstall()` then `relaunch()` (`@tauri-apps/plugin-process` — add if absent, else invoke restart via updater API). Check on mount + every 6h (`usePoll` infra).
- [ ] **Step 5:** Config: `plugins.updater.endpoints = ["https://github.com/Bigollie8/2ndmonitor/releases/latest/download/latest.json"]`, `pubkey` from Step 1, `bundle.createUpdaterArtifacts: true`. Register plugin in lib.rs after dialog plugin. Capability: `updater:default`, `process:allow-restart` if process plugin used.
- [ ] **Step 6:** `npx tsc -b && npm test && cargo test`; `npm run tauri:build` must produce the `.exe` PLUS `latest.json`-feedable signature artifacts (`*.sig`). Verify sig files exist in the bundle output.
- [ ] **Step 7:** Commit.

### Task 3: Release CI

**Files:**
- Create: `.github/workflows/release-build.yml`

- [ ] **Step 1:** Workflow: trigger `push: tags: ["v*"]`; `runs-on: windows-latest`; steps: checkout, setup-node 22, rust toolchain (dtolnay/rust-toolchain@stable), `npm ci` in `app/`, then `tauri-apps/tauri-action@v0` with `projectPath: app`, env `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` from secrets, `tagName: ${{ github.ref_name }}`, `releaseName: "2ndMonitor ${{ github.ref_name }}"`, `releaseBody` pointing at CHANGELOG, `releaseDraft: false`. tauri-action uploads the NSIS installer, the `.sig`, and generates `latest.json` on the Release.
- [ ] **Step 2:** Sanity: `permissions: contents: write` on the job; concurrency group so a re-tag doesn't race. The announce workflow coexists (both fire on the tag).
- [ ] **Step 3:** Validate YAML (`node -e` yaml parse or actionlint if available), commit. NOTE: cannot be end-to-end tested without pushing a tag — the 0.5.1 tag will be its first live run; say so honestly in the commit body.

### Task 4: Tron originals port

**Files:**
- Cherry-pick content from `feat/tron-presets`: `app/src/state/originals/*` (from `0c34d2a` — registry + 6 presets + palette + tests; content is architecture-agnostic data)
- Modify: `app/src/state/milkdrop-presets.ts` + test (add `'original'` source), `app/src/components/viz-milkdrop.tsx` (originals in the picker, grouped, accent tint per 41138ba's intent)
- Optionally port `49201cf` (preset lab dev harness) if it drops in clean; otherwise leave on the branch with a note.

**Interfaces:**
- Consumes: `mergePresetLibrary(bundledNames, user)` and `MilkdropLoadSource = { bundled } | { preset }` (current model).
- Produces: `mergePresetLibrary(originals: {id,label}[], bundledNames, user)` → originals first, keys `o:<id>`; `resolveLoadSource` returns `{ preset: buildOriginal(id) }` for `o:` entries.

- [ ] **Step 1:** `git checkout feat/tron-presets -- app/src/state/originals/` (content only, no history conflict). Run its own tests.
- [ ] **Step 2 (TDD):** extend `milkdrop-presets.test.ts`: originals sort first as a group, `o:` namespace, resolveLoadSource maps `o:` → `{preset}` via injected builder, no collision with bundled names.
- [ ] **Step 3:** Implement the model change; wire `viz-milkdrop.tsx`: picker shows an "Originals" group at top with per-preset accent tint (port 41138ba's JSX intent onto the current picker markup, not its diff).
- [ ] **Step 4:** Full suites + packaged build; select each of the 6 Tron presets in the packaged app (they exercise the sandbox eval path).
- [ ] **Step 5:** Commit.

## Self-Review Notes
- Quote fix may be obsolete post-migration (Task 1 Step 1 handles both outcomes honestly).
- The updater cannot be fully end-to-end verified until two real releases exist; Task 2 Step 6 verifies artifact generation, Task 3 notes the first-live-run caveat.
- Tron `e37e444` deliberately excluded (Global Constraints).
