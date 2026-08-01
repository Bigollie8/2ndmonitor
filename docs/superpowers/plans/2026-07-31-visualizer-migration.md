# Visualizer Migration Implementation Plan (spec F, wave 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all 15 built-in visualizer styles out of the binary and into marketplace bundles, so the catalog's "everything is a bundle you can remove" promise is literally true for visualizers.

**Architecture:** Each style becomes a `bundles/<id>/` folder that ships as a seed bundle and installs on first run through the same verified path a download takes. The built-in component is deleted, its `BUILTIN_VIZ_STYLES` entry removed, and its id added to `RETIRED_BUILTIN_VIZ_MODES` so a saved `vizMode` remaps to `bundle:<id>`. Tiles are a separate wave.

**Tech Stack:** Sandboxed JS bundles (canvas 2D and DOM), TypeScript, `node:test` via `tsx --test`.

## Global Constraints

- **`SANDBOX_CSP` is unchanged.** No `connect-src`, no `img-src`, `default-src` exactly `'none'`. A ported style must inline everything — no fonts, no images, no network. This is the only thing preventing untrusted bundle code from reaching the app's entire command surface (`docs/deferred-findings.md` item 2a). A test pins it.
- `SANDBOX_ATTR` stays `'allow-scripts'` with no `allow-same-origin`. `BROKER_COMMANDS` stays `{}`. Every ported style declares `permissions: []`.
- `milkdrop` and `scripted` are **first-party and never migrate** — one hosts a bundled library and preset store, the other is the authoring surface. They stay in `BUILTIN_VIZ_STYLES` and in `firstParty.ts`.
- Bundle ids must match `[a-z0-9-]` and versions must contain **no hyphen** (the seed filename splits on the last one; `bundles.mjs seed` rejects a violation).
- Seed zips carry exactly `manifest.json` + `main.js`. Any other entry aborts the install.
- Frontend tests: `npm test`, `node:test` + `node:assert/strict`, pure modules only. Typecheck with `npx tsc -b` (NOT `--noEmit`).
- Baselines: **458 frontend, 76 app-cargo, 66 server**. Each task states its new total.
- **The marketplace's public HTTPS route is down** (`docs/deferred-findings.md` item 20), so nothing here publishes. Seeding is local and unaffected — that is the whole delivery mechanism for this wave.

## The fallback problem — read before Task 5

`bars` is currently the hardcoded fallback in at least two places:
- `contentRegistry.ts`'s `remapRetiredVizMode` returns `'bars'` for any unrecognised mode.
- `App.tsx`'s `onVisualizerRemoved` falls back to `'bars'` when no survivor is found.

Retiring `bars` makes both point at a style that no longer exists in `BUILTIN_VIZ_STYLES`, so they would resolve to nothing and render a blank surface. Task 5 must fix this, and the fix is **not** simply `'bundle:bars'` — a user who removed the bars bundle would hit the same dead end. The fallback must be "the first style that actually exists right now", with a genuinely-nothing-installed case that renders an empty state rather than a black void.

---

### Task 1: Port `bars`, `waveform`, `radial`

**Files:**
- Create: `bundles/bars/{manifest.json,main.js,README.md}` and the same for `waveform`, `radial`

**Sources:** `app/src/components/viz.tsx` — `HiFiVizBars` (:214), `HiFiVizWaveform` (:287), `HiFiVizRadial` (:360). Read each in full before porting.

- [ ] **Step 1: Port each style**

`surface: "canvas"` (or omit — it defaults), `api: 1`, `permissions: []`. Use `viz.canvas` and its 2D context. Read the spectrum with `viz.bins(N)` where **N is whatever the original passed to `makeSpectrumReader`** — not the `const N` near it, which is usually a particle or marker count. Getting this wrong was the single most common error in the previous migration wave.

Theme colours arrive per frame as `f.theme.accent` / `f.theme.accent2`. Do not hardcode them.

- [ ] **Step 2: Validate and smoke-test**

Run: `cd app && npm run bundles:build`
Expected: all three validate and zip with exactly `manifest.json` + `main.js` — list the entries programmatically, do not assume.

Run: `cd app && npm test`
Expected: the bundle smoke suite picks up the three new folders and passes. New total: 458 + 3 = **461** (the suite adds one case per bundle).

- [ ] **Step 3: Commit**

```bash
git add bundles/bars bundles/waveform bundles/radial
git commit -m "feat(bundles): port bars, waveform and radial to canvas bundles"
```

---

### Task 2: Port `particles` and `ambient`

**Files:**
- Create: `bundles/particles/{manifest.json,main.js,README.md}`, `bundles/ambient/{...}`

**Sources:** `viz.tsx` — `HiFiVizParticles` (:433), `HiFiVizAmbient` (:559).

These two carry per-frame state (particle positions, blob phases) across frames, unlike the three stateless ones in Task 1. Keep that state in module scope inside `main.js`, initialised once, exactly as the originals keep it in refs.

- [ ] **Step 1: Port both**

Same rules as Task 1. Pay attention to `dt` — the originals advance state per frame and the frame payload provides `f.dt` in seconds. Use it rather than assuming a fixed step, or the bundles will run at a different speed from the originals on a 144Hz display.

- [ ] **Step 2: Validate and smoke-test**

Run: `cd app && npm run bundles:build && npm test`
Expected: both validate; zip entries exactly `manifest.json` + `main.js`. New total: **463**.

- [ ] **Step 3: Commit**

```bash
git add bundles/particles bundles/ambient
git commit -m "feat(bundles): port particles and ambient to canvas bundles"
```

---

### Task 3: Port `splitmirror`, `circular`, `tunnel`, `pixelled`, `ribbon`

**Files:**
- Create: `bundles/<id>/{manifest.json,main.js,README.md}` for each

**Sources:** `app/src/components/viz-extra.tsx` — `VizSplitMirror` (:43), `VizCircularPulse` (:83), `VizWaveformTunnel` (:138), `VizPixelLED` (:195), `VizRibbon` (:248).

These are **DOM styles** — `surface: "dom"`, using `viz.root`. `bundles/neonbars` is the worked example from spec E; read it first, including its comment about building elements once and writing only the animating property per frame.

- [ ] **Step 1: Port each**

Build the element tree once, then per frame write only what changes. Rewrite theme-derived styles only when `f.theme.accent`/`accent2` actually change — a steady theme must not churn N style strings at 60fps.

- [ ] **Step 2: Validate and smoke-test**

Run: `cd app && npm run bundles:build && npm test`
Expected: all five validate; entries exactly `manifest.json` + `main.js`. New total: **468**.

- [ ] **Step 3: Commit**

```bash
git add bundles/splitmirror bundles/circular bundles/tunnel bundles/pixelled bundles/ribbon
git commit -m "feat(bundles): port five DOM visualizer styles"
```

---

### Task 4: Port `vinyl`, `kaleidoscope`, `freqgrid`, `minimal`

**Files:**
- Create: `bundles/<id>/{manifest.json,main.js,README.md}` for each

**Sources:** `viz-extra.tsx` — `VizVinyl` (:297), `VizKaleidoscope` (:458), `VizFreqGrid` (:500), `VizMinimalDots` (:562).

`vinyl` is the awkward one: it reads `track` and `playback` from its props, which arrive on the frame payload as `f.track` and `f.playback` (the latter already interpolated to a live position — see `VizPlayback` in `manifest.ts`). Both can be `null`; handle that rather than assuming a track is loaded.

- [ ] **Step 1: Port each**

- [ ] **Step 2: Validate and smoke-test**

Run: `cd app && npm run bundles:build && npm test`
Expected: all four validate. New total: **472**.

- [ ] **Step 3: Commit**

```bash
git add bundles/vinyl bundles/kaleidoscope bundles/freqgrid bundles/minimal
git commit -m "feat(bundles): port the remaining four DOM visualizer styles"
```

---

### Task 5: Retire the built-ins and fix the fallbacks

**Files:**
- Modify: `app/src/components/viz-styles.ts`, `app/src/components/viz.tsx`, `app/src/state/contentRegistry.ts`, `app/src/App.tsx`
- Delete: `app/src/components/viz-extra.tsx`
- Modify: `app/src/state/contentRegistry.test.ts`

- [ ] **Step 1: Fix the fallbacks first, before deleting anything**

`remapRetiredVizMode` returns `'bars'` for an unrecognised mode, and `App.tsx`'s `onVisualizerRemoved` falls back to `'bars'`. Both break the moment `bars` leaves `BUILTIN_VIZ_STYLES`.

Change both to resolve against **what actually exists at call time** — the first entry of the merged style list — and handle the genuinely-empty case explicitly. Do not substitute `'bundle:bars'`: a user who removed that bundle hits the same dead end.

Write tests for: a saved mode naming a retired style, a saved mode naming nothing recognisable, and the empty-catalog case.

- [ ] **Step 2: Extend the retired list**

Add all 15 ids to `RETIRED_BUILTIN_VIZ_MODES` in `contentRegistry.ts`, so a saved `vizMode` of `bars` remaps to `bundle:bars`.

- [ ] **Step 3: Delete the built-ins**

Remove the 15 entries from `BUILTIN_VIZ_STYLES` (leaving `milkdrop` and `scripted`), delete `HiFiVizBars`/`Waveform`/`Radial`/`Particles`/`Ambient` from `viz.tsx` and their dispatch cases, and delete `viz-extra.tsx` entirely. Let `tsc -b` find every site — a missed one must be a build error, not a runtime blank.

- [ ] **Step 4: Generate the seed zips**

Run: `cd app && npm run bundles:seed`
Expected: 15 new visualizer seed zips alongside the existing ones. Confirm none contains anything but `manifest.json` + `main.js`.

- [ ] **Step 5: Run everything**

Run: `cd app && npm test && npx tsc -b`, then `cd src-tauri && cargo test`
Expected: pass. State the new frontend total; it will move as deleted tests go and new fallback tests arrive.

- [ ] **Step 6: Commit**

```bash
git add -A app/src bundles app/src-tauri/resources/seed
git commit -m "refactor(viz): retire the 15 built-in styles for bundles"
```

---

### Task 6: Verify the whole wave in a packaged build

No new files — this is the gate.

`tauri dev` is **not sufficient**: it serves from Vite, Tauri injects no CSP, and that divergence hid a completely broken sandbox on this branch once already.

- [ ] **Step 1: Build and launch**

Run: `cd app && npm run tauri build`, then launch the release exe.

- [ ] **Step 2: Confirm first-run seeding delivers the styles**

Move the installed `visualizers/` folder aside first so this is a genuine cold start. Launch, and confirm the 15 styles install on boot and appear in the catalog and the V-cycle.

- [ ] **Step 3: Confirm each style actually renders**

Cycle through all 15 with audio playing and confirm each draws and reacts. Report any that do not, by name — a style that renders black is a failed port, not a cosmetic issue.

Avoid CDP `captureScreenshot` with a `clip` argument; it corrupted the WebView2 viewport to 16×16 in an earlier task. Full-viewport captures or DOM/canvas introspection are safe.

- [ ] **Step 4: Confirm the upgrade path**

Hand-edit the saved `vizMode` in `tweaks.json` to `"bars"` (the pre-migration value), launch, and confirm it resolves to the bundle rather than a blank surface.

- [ ] **Step 5: Confirm the fallback**

Remove every visualizer from the catalog and confirm the app shows an empty state rather than a black void or a crash.

- [ ] **Step 6: Record deltas honestly**

The previous canvas migration had known, accepted visual deltas. List what differs rather than claiming identity — a difference you name is useful, a claim of identity nobody checked is not.

---

## Self-Review

**Coverage:** 5 canvas styles → Tasks 1-2; 9 remaining DOM styles → Tasks 3-4 (`neonbars` ported in spec E); retirement, fallbacks and seeding → Task 5; packaged verification → Task 6.

**Deliberately out of scope:** the 26 tiles (a separate wave); publishing to the marketplace (its HTTPS route is down); the `milkdrop` and `scripted` engines (first-party forever).

**Known risk:** `vinyl` depends on `track`/`playback`, both nullable. `particles` and `ambient` carry cross-frame state. These three are the likeliest to look wrong.

**Test totals:** frontend 458 → ~472 through Task 4, then moving in Task 5 as built-in tests are deleted and fallback tests added.
