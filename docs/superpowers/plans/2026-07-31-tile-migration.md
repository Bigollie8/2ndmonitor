# Tile Migration Implementation Plan (spec F, wave 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the nine currently-migratable built-in tiles out of the binary into declarative marketplace bundles.

**Scope, and why it is nine and not twenty-three:** 33 built-in tiles remain; 10 are first-party and never migrate (they need native capability the sandbox does not expose). Of the 23 targets, **11 are blocked** on the shared saved-location capability and **3** on durable per-instance state — see `docs/deferred-findings.md` item 25. This wave takes the nine that the bundle format already expresses.

**Architecture:** Each tile becomes a `bundles/tile-<id>/` folder with `manifest.json` + `view.json`, shipping as a seed bundle. The built-in component is deleted and its id added to `RETIRED_TILE_TYPES` so saved layouts remap. The visualizer wave (`docs/superpowers/plans/2026-07-31-visualizer-migration.md`) is the template for how a wave like this runs.

## Global Constraints

- **A tile bundle's zip carries `manifest.json` + `view.json`** — never `main.js`. The zip-entry allowlist is exact-match and an unexpected entry aborts the install. Getting this backwards is exactly the bug that shipped three uninstallable tiles at 1.0.0.
- Secrets go in `source.headers` as `{{secret.<key>}}`, and every `secret:<key>` permission needs a matching `secrets` manifest entry and vice versa — `validateManifest` enforces both directions, and the view spec **rejects** a secret placeholder anywhere under `view` so a credential cannot reach rendered output.
- `source.url` must be `https://`. `intervalMs` has a floor (15s) and a 24h ceiling.
- Every `net:<host>` the tile fetches must be declared. `BROKER_COMMANDS` stays `{}`; no tile gets a `tauri:` permission.
- Bundle ids match `[a-z0-9-]` and versions contain **no hyphen**.
- `SANDBOX_CSP` unchanged.
- Frontend tests: `npm test`, `node:test` + `node:assert/strict`. Typecheck with `npx tsc -b` (NOT `--noEmit`).
- Baselines: **555 frontend, 76 app-cargo, 66 server**. The smoke suite adds cases per bundle; report the actual delta and account for it rather than predicting.
- The marketplace's public HTTPS route is down (`docs/deferred-findings.md` item 20), so nothing publishes. **Seeding is the delivery mechanism.**

## The trap this wave inherits

A declarative tile's paths are resolved against the response, and a `select` is applied first. `tile-dailychallenge` shipped broken because LeetCode's GraphQL wraps its payload in a top-level key *also* called `data`, colliding with the template scope's `data` root — every path was one level too shallow, and neither the grammar validator nor the smoke harness could catch it because both only check path *shape*, never resolution.

**So: for every tile, fetch the real endpoint once and run the actual paths against the actual response before claiming it works.** A path that validates is not a path that resolves.

---

### Task 1: Port the four uncredentialed tiles

**Files:** create `bundles/tile-onthisday/`, `tile-randomwiki/`, `tile-launches/`, `tile-stocks/` — each `manifest.json`, `view.json`, `README.md`.

**Sources:** `app/src/components/OnThisDayTile.tsx`, `RandomWikiTile.tsx`, `LaunchesTile.tsx`, `StocksTile.tsx`. Read each for its endpoint, poll interval, and the exact fields it renders.

**Worked example:** `bundles/tile-quote/` — read it first.

- [ ] **Step 1: Port each**

`api: 1`, `permissions: ["net:<host>"]` for whatever host it fetches. Match the original's poll interval; if the original's is below the 15s floor, raise it to the floor and say so.

`stocks` is the awkward one: the built-in reads a user-configured watchlist. Declare that as a `config` entry so the user can set it, and note in the README that it starts empty.

- [ ] **Step 2: Resolve every path against a real response**

For each tile, fetch its endpoint and run the view's paths against the actual JSON — not a fixture, not by eye. Report the resolved values. If a `select` is needed to unwrap an envelope, this is where you find out.

- [ ] **Step 3: Validate and smoke-test**

Run: `cd app && npm run bundles:build` — all four validate and zip. **List the zip entries programmatically**; each must be exactly `manifest.json` + `view.json`, with **no `main.js`**.

Run: `cd app && npm test && npx tsc -b`

- [ ] **Step 4: Commit**

```bash
git add bundles/tile-onthisday bundles/tile-randomwiki bundles/tile-launches bundles/tile-stocks
git commit -m "feat(bundles): port four uncredentialed tiles"
```

---

### Task 2: Port the five credentialed tiles

**Files:** create `bundles/tile-githubprs/`, `tile-homeassistant/`, `tile-energy/`, `tile-phonenotifs/`, `tile-birds/`.

**Sources:** `GithubPrsTile.tsx`, `HomeAssistantTile.tsx`, `EnergyTile.tsx`, `PhoneNotifsTile.tsx`, `BirdsTile.tsx`.

- [ ] **Step 1: Port each**

Declare each credential twice — a `secrets` entry (key, label, kind, help) **and** a matching `secret:<key>` permission. `validateManifest` enforces both directions and will reject a mismatch.

Put the credential in `source.headers` as `{{secret.<key>}}`. **Never** in `source.url` unless the API genuinely has no header auth — a URL-embedded secret is more exposed. Never anywhere under `view`; the validator rejects it and the reason is that a credential must not reach rendered output.

`homeAssistant` and `energy` both talk to a user's own Home Assistant instance, so their host is not a fixed literal — work out how the existing built-ins resolve it and whether a `config` entry for the base URL is needed. If the `net:` permission cannot be expressed for a user-supplied host, **stop and report that** rather than inventing a wildcard.

- [ ] **Step 2: Resolve paths against real responses where you can**

You will not have live credentials for most of these. Say plainly which you could exercise and which you could not, and for the latter, verify the paths against the built-in's own parsing code rather than guessing.

- [ ] **Step 3: Validate and smoke-test**

Same as Task 1 — zip entries exactly `manifest.json` + `view.json`.

- [ ] **Step 4: Commit**

```bash
git add bundles/tile-githubprs bundles/tile-homeassistant bundles/tile-energy bundles/tile-phonenotifs bundles/tile-birds
git commit -m "feat(bundles): port five credentialed tiles"
```

---

### Task 3: Retire the seven built-ins

**Files (seven tiles, not nine — see the ruling below):** modify `app/src/state/tileMeta.ts`, `app/src/state/layout.ts`, `app/src/App.tsx` (the `renderTile` dispatch); delete the seven `*Tile.tsx` components.

The visualizer wave's equivalent task found **seven** hardcoded references to a retiring id where the plan named two. Search before you delete.

- [ ] **Step 1: Extend `RETIRED_TILE_TYPES`**

In `layout.ts`, map each retiring id to its bundle: `onThisDay` → `bundle:tile-onthisday`, and so on. Note the ids differ in shape — built-ins are camelCase, bundles are lowercase-hyphen — so this is a rename, not a prefix.

**RULING FROM TASK 1'S REVIEW — do not retire `onThisDay` or `stocks`.** Their bundles exist but are *additional* listings, not replacements. `tile-onthisday` pins a date at install and never displays which date, so it silently shows stale history under a title asserting currency. `tile-stocks` is `multiInstance: false`, so a 25-ticker watchlist becomes at most one ticker anywhere on the dashboard — eliminating the feature rather than reducing it. Both are format limitations, not port errors, and the precedent already set for the 11 location-blocked and 3 state-blocked tiles applies: the built-in stays.

**This task therefore retires SEVEN tiles, not nine:** `randomWiki`, `launches`, `githubPrs`, `homeAssistant`, `energy`, `phoneNotifs`, `birds`.

- [ ] **Step 2: Delete the built-ins**

Remove the seven from `TILE_META`, `ALL_TILE_TYPES`, both default-rect maps and the `renderTile` dispatch, and delete their components. `TILE_META` is `Record<BuiltinTileType, TileMeta>`, so the compiler refuses an incomplete table — let `tsc -b` find every site.

- [ ] **Step 3: Seed**

Run: `cd app && npm run bundles:seed`. Confirm nine new tile seeds, each exactly `manifest.json` + `view.json`.

- [ ] **Step 4: Test**

Run: `cd app && npm test && npx tsc -b`, then `cd src-tauri && cargo test`. Report the delta with an accounting.

- [ ] **Step 5: Commit**

```bash
git add -A app/src bundles app/src-tauri/resources/seed
git commit -m "refactor(tiles): retire the nine migrated built-ins"
```

---

### Task 4: Verify in a packaged build

`tauri dev` is not acceptable — it serves from Vite with no injected CSP, which is how a completely broken sandbox once shipped on this branch.

- [ ] **Step 1:** `npm run tauri build`, launch the release exe.
- [ ] **Step 2:** Cold-start seeding — move the installed `tiles/` folder aside, launch, confirm all nine install on boot and appear in the content library.
- [ ] **Step 3:** Place each of the nine on the dashboard (both onThisDay variants coexist — built-in and bundle) and confirm it renders real data. **Report any that show an error or an empty state, by name.** For credentialed tiles without a credential, the correct result is the needs-setup state, not a blank or an error — confirm which you see.
- [ ] **Step 4:** Upgrade path — hand-edit a saved layout to contain a pre-migration type such as `"onThisDay"`, launch, and confirm it resolves to the bundle or offers to install it, never a blank tile.
- [ ] **Step 5:** Record deltas honestly against the deleted originals (`git show <commit>^:app/src/components/OnThisDayTile.tsx` etc.).

---

## Self-Review

**Coverage:** four uncredentialed → Task 1; five credentialed → Task 2; retirement and seeding → Task 3; packaged verification → Task 4.

**Out of scope:** the 11 location-blocked tiles and the 3 state-blocked ones (`docs/deferred-findings.md` item 25); publishing (the marketplace route is down); the 10 first-party tiles.

**Known risk:** `homeAssistant` and `energy` point at a user-supplied host, which may not be expressible as a `net:` permission. That is a stop-and-report, not something to paper over with a wildcard.
