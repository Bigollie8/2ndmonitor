# Unified content catalog — design

**Date:** 2026-07-30
**Branch:** `feat/milkdrop-visualizer` (worktree `2ndmonitor-milkdrop`)
**Scope:** pieces **A + B** of the marketplace uplevel program. Previews (C), ratings (D), DOM sandbox (E) and content-migration waves (F) are separate specs.

---

## 1. Goal

Every tile and every visualizer lives in one catalog. The base set is simply what ships pre-installed, not a privileged tier: the user can remove official content as freely as marketplace content, and get it back later. A single surface answers "what exists, what do I have, what can I add" at a glance.

Today that is split across three surfaces (`TileLibrary` for built-in tiles, `MarketplaceTab` for server bundles, the viz gallery for styles), and official content cannot be removed at all.

## 2. The one decision that shapes everything

Sandboxed bundle code cannot invoke native commands. `BROKER_COMMANDS` in `app/src/sandbox/broker.ts` is `{}`, and `broker.test.ts` asserts it stays empty. Bundles get `net:<host>` fetches and nothing else.

So tiles whose data comes from Rust cannot become sandboxed bundles without handing untrusted marketplace code access to the machine. **We are not opening that allowlist, and we are not building a dynamic loader for privileged React code.** Instead the catalog carries two backings behind one identical presentation:

| | `first-party` | `bundle` |
|---|---|---|
| Code lives | compiled into the binary | `%APPDATA%/…/{tiles,visualizers}/<id>/` |
| Install | always present | download + verify, or seed copy |
| Remove | dropped from catalog, dashboard and pickers; bytes stay | folder deleted |
| Needs network to restore | no | no — seed fallback (§5) |

The card, the badges and the Remove button are identical in both cases. The only difference is whether bytes leave the disk.

### 2.1 First-party set

Classification rule: **an item is first-party if and only if it needs a capability the sandbox does not expose** — local system access, OS media APIs, or a transport other than `fetch`. An item that only needs HTTP is a bundle, even if it currently reaches the network through a Rust proxy command (those proxies exist for CORS, and `net:<host>` replaces them).

By that rule the first-party set is:

| Item | Capability that forces it |
|---|---|
| `viz` | live audio spectrum/waveform from `audio.rs` |
| `spotify` (Now playing) | GSMTC session via `nowplaying.rs` / `spotify.rs` |
| `mixer` | per-app volume via WASAPI/COM (`mixer.rs`) |
| `sysmon` | CPU/RAM/GPU counters (`sysmon.rs`) |
| `discord` | Discord IPC pipe (`discord_rpc.rs`) |
| `claude` | reads local session files (`claude.rs`) |
| `streamDeck` | dispatches app actions (`actions.rs`) |
| `activeWindow` | foreground-window tracking (`foreground.rs`) |
| `docker` | local Docker socket (`docker_tile.rs`) |
| `streamChat` | Twitch IRC over WebSocket; sandbox CSP is `default-src 'none'` and the broker offers only `fetch` |
| `milkdrop` (viz engine) | hosts the bundled Butterchurn library and the local preset store |
| `scripted` (viz engine) | the authoring entry point for local drafts, not a style — it is the surface that *creates* bundles |

Twelve items: ten tiles and the two visualizer engines. `BUILTIN_VIZ_STYLES` holds 17 entries — 15 styles plus those 2 engines — so the bundle targets are **26 tiles and 15 visualizer styles**. `notes`, `scratchpad` and `pomodoro` are pure local UI with no native need; they qualify as bundles and are simply low-priority migrations.

Of the 15 style targets, 5 are canvas-rendered (`bars`, `waveform`, `radial`, `particles`, `ambient`, all in `viz.tsx`) and migrate under the current canvas-only sandbox. The other 10 live in `viz-extra.tsx` and render DOM divs with CSS transforms — that file contains zero `getContext` calls — so they are blocked on the DOM sandbox (spec E).

Plan Task 1 re-derives this list mechanically from imports and fails if it disagrees with the table above, so the classification cannot rot.

## 3. Catalog model

A new pure module `app/src/state/catalog.ts` — no React, no Tauri, node-testable — merges three inputs into one list. `contentRegistry.ts` grows into this module rather than a second merge living beside it; `mergeVizStyles` becomes a thin caller so the V-cycle, Settings dropdown and Stream Deck actions keep working unchanged.

```ts
export type CatalogKind = 'tile' | 'visualizer';
export type CatalogSource = 'first-party' | 'bundle';

export interface CatalogItem {
  /** `${kind}:${id}` — the identity used by every list, map and action. */
  key: string;
  kind: CatalogKind;
  id: string;
  name: string;
  description: string;
  category: 'weather' | 'system' | 'media' | 'productivity' | 'ambient' | 'integrations';
  source: CatalogSource;

  installed: boolean;
  installedVersion: string | null;   // from the on-disk manifest
  availableVersion: string | null;   // from the signed index
  updateAvailable: boolean;

  permissions: string[];
  needsSetup: boolean;               // declared secrets/config still unset
  downloads: number | null;
  brokenReason: string | null;       // manifest_error, surfaced not hidden
}
```

Inputs:

1. `FIRST_PARTY_ITEMS` — compile-time table derived from `TILE_META` and `BUILTIN_VIZ_STYLES`.
2. Installed folders — `tiles_list` + `visualizers_list`, fetched with `allSettled` so one failure cannot blank the other.
3. The signed index — `marketplace_fetch_index`, unchanged and still signature-verified in Rust.

Precedence when an id appears in more than one input: on-disk manifest wins for `installedVersion`, index wins for `availableVersion`, and an id present in both the first-party table and the index is a **migrated** item — the bundle wins and the first-party entry is dropped. That rule is what retires content as migration waves land, with no UI change.

## 4. Removal

- **Bundle item** → `marketplace_uninstall` deletes the folder.
- **First-party item** → filtered out of the catalog, tile picker, dashboard and V-cycle.

Both also write the item's key to a single persisted list, `catalog.removed: string[]`, in the tweaks store (`src-tauri/src/tweaks.rs`) rather than localStorage — so it travels with settings export/import, and a restored backup restores the user's content choices too. One list, one meaning: *the user does not want this*. It is what stops an app update's seed pass (§5) from resurrecting something deliberately removed, and it is why removing a bundle needs a tombstone even though the folder is already gone.

Removing an item that is placed on the dashboard removes its instances in the same action. `MissingTileCard` remains the safety net for a layout that references absent content.

**Restore defaults** clears `catalog.removed` and re-runs the seed pass. Reachable from the catalog's empty state, so removing everything is recoverable rather than a dead end.

## 5. Seeding and offline

The base set ships as real bundles in Tauri resources: `src-tauri/resources/seed/<kind>/<id>-<version>.zip`, structurally identical to what the server serves.

At startup `seed_sync` installs every seed bundle that is not installed and not in `catalog.removed`. It runs asynchronously and never blocks the window: on a first run the catalog fills in as bundles land, and the dashboard renders throughout. **It runs through the same install path as `marketplace_install`** — same zip-entry allowlist, same manifest validation, same `installed.json` marker — with the resource read swapped in for the network fetch. This is load-bearing: the broken 1.0.0 tiles shipped precisely because a hand-copy into `%APPDATA%` bypassed `marketplace_install`. A seed bundle gets no privileged path.

`marketplace_install` gains a seed fallback: when the network fetch fails and a matching `id@version` exists in resources, install from the seed copy. Removing Bars on a plane and wanting it back therefore still works.

`installed.json` records `origin: 'seed' | 'marketplace'` so the catalog can label provenance and a newer server version can supersede a seeded one.

Seed sync failure is logged and non-fatal — the app boots regardless.

## 6. UI

One `ContentLibrary` component, layout B (category rail + grid), replacing three surfaces:

- `TileLibrary.tsx` — absorbed
- `MarketplaceTab.tsx` — absorbed; its server URL + pubkey editor moves to Settings → Marketplace, where a rarely-touched setting belongs
- the viz gallery — absorbed

**Left rail:** All, Installed, Updates, Needs setup, then Tiles by category, then Visualizers by category — every row carrying a live count. The counts are the "at a glance" answer: the shape of the catalog is visible before anything is typed.

**Right pane:** card grid — preview thumb (placeholder until spec C), name, `kind · version · author`, primary action, and state tags (`core`, `new`, `needs key`, `update`, `error`).

**Search** filters within the selected rail slice, and when that yields nothing, offers an explicit "search all content" rather than silently widening.

The permissions confirmation dialog is unchanged and still gates every bundle that declares permissions.

## 7. Error handling

- **Index unreachable** → the catalog still renders from first-party plus installed content, with an inline "marketplace unreachable — showing local content" notice and a retry. This replaces today's behaviour, where a transient failure at launch produces a red error banner over a catalog that cannot show local state. That exact failure was observed on 2026-07-30 after a cold boot.
- **Broken installed manifest** → the card renders in an error state showing `brokenReason` with a Remove action. Never silently hidden.
- **Uninstall failure** → surfaced on the card, and `catalog.removed` is *not* written, so state stays honest.

## 8. Cleanup folded in

`quote`, `wordOfDay` and `dailyChallenge` currently exist twice — as built-in tiles and as published bundles — so users see duplicates today. The built-in versions are deleted and saved layouts remapped to the bundle ids, mirroring what `remapRetiredVizMode` already does for retired visualizer styles.

## 9. Testing

- `state/catalog.ts` — node tests over the three input shapes: precedence, update detection, suppression, broken manifests, the migrated-item rule, and the duplicate collapse.
- Rust — `seed_sync` installs through the real path; a seed zip carrying a disallowed entry is rejected exactly as a downloaded one is; suppression blocks resurrection; the seed fallback fires only when the network fails.
- A drift test asserting every `FIRST_PARTY_ITEMS` id exists in `TILE_META` or `BUILTIN_VIZ_STYLES`, and that no first-party id is also a published bundle id except during a migration wave.
- Manual verification, in the app: remove an official visualizer, confirm it leaves the V-cycle and the gallery; restart and confirm it stays gone; restore defaults and confirm it returns.

## 10. Explicitly out of scope

Previews (C), ratings and sign-in (D), the DOM sandbox (E), and the migration waves themselves (F). This spec delivers the contract those plug into, and ships with the catalog fully functional over today's 15 bundles plus the existing built-in content.
