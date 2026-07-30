# Unified Content Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One catalog surface where every tile and visualizer — official or marketplace — can be browsed, installed and removed, backed by a seed-bundle system that makes removal real and recovery offline-safe.

**Architecture:** A pure merge module (`state/catalog.ts`) folds four inputs — the compile-time tile/viz tables, the installed folders on disk, the signed marketplace index, and a persisted removal list — into one `CatalogItem[]`. A new `ContentLibrary` component renders that list as a category rail plus a card grid, replacing three existing surfaces. On the Rust side, `marketplace_install`'s core is extracted so a new `seed_sync` can install app-shipped seed bundles through the identical verification path, and so a failed network install can fall back to a seed copy.

**Tech Stack:** React 18 + TypeScript (Vite), Rust + Tauri 2, `node:test` via `tsx --test`, `cargo test`.

## Global Constraints

- `BROKER_COMMANDS` in `app/src/sandbox/broker.ts` stays `{}`. No task may add an entry. `broker.test.ts` asserts this.
- Seed bundles MUST be installed through the same code path as downloaded bundles — same zip-entry allowlist, same manifest validation, same `installed.json` marker. No hand-copying into `%APPDATA%`.
- The zip-entry allowlist stays exactly `{manifest.json, main.js, preset.json, view.json}` with exact-string matching. `installed.json` is never an accepted entry.
- Frontend tests run under `npm test` (`tsx --test src/**/*.test.ts`), using `node:test` + `node:assert/strict`. Pure modules only — no React, no Tauri imports in a `.test.ts`.
- The first-party set is exactly 12 items: tiles `viz`, `spotify`, `mixer`, `sysmon`, `discord`, `claude`, `streamDeck`, `activeWindow`, `docker`, `streamChat`; viz engines `milkdrop`, `scripted`.
- Item identity everywhere is `` `${kind}:${id}` `` — e.g. `tile:quote`, `visualizer:aurora`.
- Existing test counts must not regress: 332 frontend, 41 cargo. Each task states its new total.

---

### Task 1: Catalog metadata — viz categories and the first-party table

**Files:**
- Modify: `app/src/components/viz-styles.ts`
- Create: `app/src/state/firstParty.ts`
- Test: `app/src/state/firstParty.test.ts`

**Interfaces:**
- Consumes: `TILE_META` from `state/tileMeta.ts`, `BUILTIN_VIZ_STYLES` from `components/viz-styles.ts`.
- Produces: `VizCategory`, `VizStyle.category`, `FIRST_PARTY_TILES`, `FIRST_PARTY_VIZ`, `isFirstParty(kind, id)`.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/state/firstParty.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { FIRST_PARTY_TILES, FIRST_PARTY_VIZ, isFirstParty } from './firstParty';
import { TILE_META } from './tileMeta';
import { BUILTIN_VIZ_STYLES } from '../components/viz-styles';

test('firstParty: every listed tile id is a real built-in tile', () => {
  for (const id of FIRST_PARTY_TILES) {
    assert.ok(id in TILE_META, `${id} is not in TILE_META`);
  }
});

test('firstParty: every listed viz id is a real built-in style', () => {
  const ids = new Set(BUILTIN_VIZ_STYLES.map((s) => s.id));
  for (const id of FIRST_PARTY_VIZ) {
    assert.ok(ids.has(id), `${id} is not in BUILTIN_VIZ_STYLES`);
  }
});

test('firstParty: the set is exactly the 12 documented items', () => {
  assert.equal(FIRST_PARTY_TILES.length, 10);
  assert.equal(FIRST_PARTY_VIZ.length, 2);
});

test('firstParty: isFirstParty discriminates by kind', () => {
  assert.equal(isFirstParty('tile', 'mixer'), true);
  assert.equal(isFirstParty('tile', 'quote'), false);
  assert.equal(isFirstParty('visualizer', 'scripted'), true);
  assert.equal(isFirstParty('visualizer', 'bars'), false);
  // A tile id must not match on the visualizer side.
  assert.equal(isFirstParty('visualizer', 'mixer'), false);
});

test('viz styles: every built-in style carries a category', () => {
  for (const s of BUILTIN_VIZ_STYLES) {
    assert.ok(s.category, `${s.id} has no category`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx tsx --test src/state/firstParty.test.ts`
Expected: FAIL — `Cannot find module './firstParty'`.

- [ ] **Step 3: Add the category field to viz styles**

In `app/src/components/viz-styles.ts`, extend the interface and annotate every entry:

```ts
export type VizCategory = 'spectrum' | 'wave' | 'ambient' | 'scene' | 'engine';

export interface VizStyle { id: VizMode; label: string; desc: string; category: VizCategory }

export const BUILTIN_VIZ_STYLES: VizStyle[] = [
  { id: 'bars',         label: 'Bars',           desc: 'Classic spectrum analyzer',      category: 'spectrum' },
  { id: 'waveform',     label: 'Waveform',       desc: 'Smooth oscilloscope',            category: 'wave' },
  { id: 'radial',       label: 'Radial',         desc: 'Circular spectrum',              category: 'spectrum' },
  { id: 'particles',    label: 'Particles',      desc: 'Drifting points',                category: 'ambient' },
  { id: 'ambient',      label: 'Ambient',        desc: 'Slow morphing blobs',            category: 'ambient' },
  { id: 'neonbars',     label: 'Neon bars',      desc: 'Glowing solid bars',             category: 'spectrum' },
  { id: 'splitmirror',  label: 'Split mirror',   desc: 'Mirrored bars on a horizon',     category: 'spectrum' },
  { id: 'circular',     label: 'Circular pulse', desc: 'Radial w/ bass disc',            category: 'spectrum' },
  { id: 'tunnel',       label: 'Wave tunnel',    desc: 'Layered depth waveforms',        category: 'wave' },
  { id: 'pixelled',     label: 'Pixel LED',      desc: 'Retro LED matrix · heatmap',     category: 'spectrum' },
  { id: 'ribbon',       label: 'Ribbon',         desc: 'Filled symmetric flow',          category: 'wave' },
  { id: 'vinyl',        label: 'Vinyl',          desc: 'Spinning record',                category: 'scene' },
  { id: 'kaleidoscope', label: 'Kaleidoscope',   desc: 'Symmetric petals',               category: 'scene' },
  { id: 'freqgrid',     label: 'Freq grid',      desc: 'Time × frequency cells',         category: 'spectrum' },
  { id: 'minimal',      label: 'Minimal dots',   desc: 'Bass / Mid / Treble pulse',      category: 'ambient' },
  { id: 'milkdrop',     label: 'MilkDrop',       desc: 'Butterchurn · MilkDrop 2 presets', category: 'engine' },
  { id: 'scripted',     label: 'Scripted',       desc: 'Your JS visualizers · sandboxed', category: 'engine' },
];
```

- [ ] **Step 4: Create the first-party table**

```ts
// app/src/state/firstParty.ts
// ─────────────────────────────────────────────────────────────────────────────
// Which catalog items cannot be marketplace bundles.
//
// Rule: an item is first-party if and only if it needs a capability the
// sandbox does not expose — local system access, an OS media API, or a
// transport other than `fetch`. An item that only needs HTTP is a bundle
// target even if it currently reaches the network through a Rust proxy
// command; those proxies exist for CORS, and `net:<host>` replaces them.
//
// This is a security boundary, not a convenience list. Adding an id here
// because migrating it is awkward is a misuse; adding one because sandboxed
// code would need `tauri:` access is correct. BROKER_COMMANDS stays empty.
// ─────────────────────────────────────────────────────────────────────────────

/** Tiles whose data comes from Rust. Each entry names the blocking capability. */
export const FIRST_PARTY_TILES = [
  'viz',          // live audio spectrum/waveform (audio.rs)
  'spotify',      // GSMTC session (nowplaying.rs, spotify.rs, lyrics.rs)
  'mixer',        // per-app volume via WASAPI/COM (mixer.rs)
  'sysmon',       // CPU/RAM/GPU counters (sysmon.rs)
  'discord',      // Discord IPC pipe (discord_rpc.rs)
  'claude',       // reads local session files (claude.rs)
  'streamDeck',   // dispatches app actions (actions.rs)
  'activeWindow', // foreground-window tracking (foreground.rs)
  'docker',       // local Docker socket (docker_tile.rs)
  'streamChat',   // Twitch IRC over WebSocket; sandbox CSP is default-src 'none'
] as const;

/** Visualizer entries that are engines, not styles: one hosts a bundled
 *  library and preset store, the other is the surface that authors bundles.
 *  Neither can meaningfully become a bundle itself. */
export const FIRST_PARTY_VIZ = ['milkdrop', 'scripted'] as const;

const TILES = new Set<string>(FIRST_PARTY_TILES);
const VIZ = new Set<string>(FIRST_PARTY_VIZ);

export function isFirstParty(kind: 'tile' | 'visualizer', id: string): boolean {
  return kind === 'tile' ? TILES.has(id) : VIZ.has(id);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd app && npm test`
Expected: PASS. New total: 337 (332 + 5).

- [ ] **Step 6: Fix the type errors the category field introduced**

Run: `cd app && npx tsc -b --noEmit`
Expected: clean. `VizStyle` gained a required field; any literal built elsewhere must be updated. If `useVizStyles.ts` or `contentRegistry.ts` constructs a `VizStyle`, give it `category: 'ambient'`.

- [ ] **Step 7: Commit**

```bash
git add app/src/components/viz-styles.ts app/src/state/firstParty.ts app/src/state/firstParty.test.ts
git commit -m "feat(catalog): viz style categories and the first-party classification table"
```

---

### Task 2: The catalog merge

**Files:**
- Create: `app/src/state/catalog.ts`
- Test: `app/src/state/catalog.test.ts`

**Interfaces:**
- Consumes: `InstalledTileFolder` (`tiles/tileRegistry.ts`), `InstalledVizFolder` (`state/contentRegistry.ts`), `TILE_META`, `BUILTIN_VIZ_STYLES`, `isFirstParty` (Task 1).
- Produces: `CatalogItem`, `CatalogKind`, `CatalogSource`, `catalogKey(kind, id)`, `mergeCatalog(args)`.

**Why this is a separate module from `tileRegistry`/`contentRegistry`:** those two exist to feed the *dashboard and pickers*, so they deliberately hide broken and non-marketplace folders. The catalog must do the opposite — show a broken install with its reason so the user can remove it. Same inputs, opposite policy; sharing one function would mean a boolean parameter that changes its meaning.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/state/catalog.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeCatalog, catalogKey, type MergeCatalogArgs } from './catalog';
import { TILE_META } from './tileMeta';
import { BUILTIN_VIZ_STYLES } from '../components/viz-styles';
import type { InstalledTileFolder } from '../tiles/tileRegistry';
import type { InstalledVizFolder } from './contentRegistry';

const tileFolder = (o: Partial<InstalledTileFolder> = {}): InstalledTileFolder => ({
  id: 'quote', name: 'Quote of the day', author: 'oli***', version: '1.0.1',
  api: 1, manifest_error: null, source: 'marketplace', ...o,
});
const vizFolder = (o: Partial<InstalledVizFolder> = {}): InstalledVizFolder => ({
  id: 'aurora', name: 'Aurora', author: 'oli***', version: '1.0.0',
  api: 1, manifest_error: null, source: 'marketplace', ...o,
});
const idx = (o: Record<string, unknown> = {}) => ({
  id: 'aurora', version: '1.0.0', kind: 'visualizer', name: 'Aurora',
  author: 'oli***', permissions: [], sha256: 'ab', size: 100, downloads: 40, ...o,
});

const base = (o: Partial<MergeCatalogArgs> = {}): MergeCatalogArgs => ({
  tileMeta: TILE_META, vizStyles: BUILTIN_VIZ_STYLES,
  installedTiles: [], installedViz: [], index: [], removed: [], needsSetup: [], ...o,
});

test('mergeCatalog: built-ins appear as first-party or bundle-target items', () => {
  const out = mergeCatalog(base());
  const mixer = out.find((i) => i.key === 'tile:mixer');
  assert.ok(mixer);
  assert.equal(mixer.source, 'first-party');
  assert.equal(mixer.installed, true);

  const bars = out.find((i) => i.key === 'visualizer:bars');
  assert.ok(bars);
  assert.equal(bars.source, 'bundle');
  assert.equal(bars.installed, true, 'a not-yet-migrated built-in still reads as installed');
});

test('mergeCatalog: an index entry not installed is available, not installed', () => {
  const out = mergeCatalog(base({ index: [idx({ id: 'liquid', name: 'Liquid' })] }));
  const liquid = out.find((i) => i.key === 'visualizer:liquid');
  assert.ok(liquid);
  assert.equal(liquid.installed, false);
  assert.equal(liquid.availableVersion, '1.0.0');
  assert.equal(liquid.downloads, 40);
});

test('mergeCatalog: installed + newer index version flags an update', () => {
  const out = mergeCatalog(base({
    installedViz: [vizFolder({ version: '1.0.0' })],
    index: [idx({ version: '1.1.0' })],
  }));
  const a = out.find((i) => i.key === 'visualizer:aurora');
  assert.ok(a);
  assert.equal(a.installedVersion, '1.0.0');
  assert.equal(a.availableVersion, '1.1.0');
  assert.equal(a.updateAvailable, true);
});

test('mergeCatalog: equal versions do not flag an update', () => {
  const out = mergeCatalog(base({ installedViz: [vizFolder()], index: [idx()] }));
  assert.equal(out.find((i) => i.key === 'visualizer:aurora')?.updateAvailable, false);
});

test('mergeCatalog: a removed key is dropped entirely', () => {
  const out = mergeCatalog(base({ removed: ['tile:mixer', 'visualizer:bars'] }));
  assert.equal(out.some((i) => i.key === 'tile:mixer'), false);
  assert.equal(out.some((i) => i.key === 'visualizer:bars'), false);
});

test('mergeCatalog: a removed key still listed in the index is available again', () => {
  const out = mergeCatalog(base({ removed: ['visualizer:aurora'], index: [idx()] }));
  const a = out.find((i) => i.key === 'visualizer:aurora');
  assert.ok(a, 'removed content stays browsable so it can be reinstalled');
  assert.equal(a.installed, false);
});

test('mergeCatalog: a migrated tile collapses to one item, bundle wins', () => {
  // `quote` exists as a built-in AND as an installed bundle.
  const out = mergeCatalog(base({ installedTiles: [tileFolder()] }));
  const hits = out.filter((i) => i.key === 'tile:quote');
  assert.equal(hits.length, 1, 'no duplicate card');
  assert.equal(hits[0].source, 'bundle');
  assert.equal(hits[0].installedVersion, '1.0.1');
});

test('mergeCatalog: a broken install is shown with its reason, not hidden', () => {
  const out = mergeCatalog(base({ installedViz: [vizFolder({ manifest_error: 'bad api' })] }));
  const a = out.find((i) => i.key === 'visualizer:aurora');
  assert.ok(a);
  assert.equal(a.brokenReason, 'bad api');
  assert.equal(a.installed, true);
});

test('mergeCatalog: a local draft folder is not a catalog item', () => {
  const out = mergeCatalog(base({ installedViz: [vizFolder({ id: 'draft', source: 'local' })] }));
  assert.equal(out.some((i) => i.key === 'visualizer:draft'), false);
});

test('mergeCatalog: needsSetup is carried through by key', () => {
  const out = mergeCatalog(base({ installedTiles: [tileFolder()], needsSetup: ['tile:quote'] }));
  assert.equal(out.find((i) => i.key === 'tile:quote')?.needsSetup, true);
});

test('catalogKey: composes kind and id', () => {
  assert.equal(catalogKey('tile', 'quote'), 'tile:quote');
  assert.equal(catalogKey('visualizer', 'aurora'), 'visualizer:aurora');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx tsx --test src/state/catalog.test.ts`
Expected: FAIL — `Cannot find module './catalog'`.

- [ ] **Step 3: Write the implementation**

```ts
// app/src/state/catalog.ts
// ─────────────────────────────────────────────────────────────────────────────
// The unified content catalog: one item type for every tile and visualizer,
// whatever backs it.
//
// Pure module — no React, no Tauri — so it is node-testable. The caller owns
// reading folders off disk and fetching the signed index.
//
// Distinct from tileRegistry/contentRegistry on purpose: those feed the
// dashboard and pickers and therefore HIDE broken or non-marketplace folders.
// The catalog SHOWS a broken install with its reason, because the catalog is
// where a user goes to remove it.
// ─────────────────────────────────────────────────────────────────────────────
import type { BuiltinTileType } from './layout';
import type { TileMeta, TileCategory } from './tileMeta';
import type { VizStyle, VizCategory } from '../components/viz-styles';
import type { InstalledTileFolder } from '../tiles/tileRegistry';
import type { InstalledVizFolder } from './contentRegistry';
import { isFirstParty } from './firstParty';

export type CatalogKind = 'tile' | 'visualizer';
export type CatalogSource = 'first-party' | 'bundle';

/** One entry in the signed marketplace index. Mirrors the server's index.json. */
export interface IndexBundle {
  id: string;
  version: string;
  kind: 'preset' | 'visualizer' | 'tile';
  name: string;
  author: string;
  permissions: string[];
  sha256: string;
  size: number;
  downloads: number;
}

export interface CatalogItem {
  /** `${kind}:${id}` — the identity used by every list, map and action. */
  key: string;
  kind: CatalogKind;
  id: string;
  name: string;
  description: string;
  category: TileCategory | VizCategory;
  source: CatalogSource;

  installed: boolean;
  installedVersion: string | null;
  availableVersion: string | null;
  updateAvailable: boolean;

  permissions: string[];
  needsSetup: boolean;
  downloads: number | null;
  brokenReason: string | null;
}

export interface MergeCatalogArgs {
  tileMeta: Record<BuiltinTileType, TileMeta>;
  vizStyles: VizStyle[];
  installedTiles: InstalledTileFolder[];
  installedViz: InstalledVizFolder[];
  /** Empty when the marketplace is unreachable — the catalog still renders. */
  index: IndexBundle[];
  /** Keys the user removed. Persisted; see state/removedContent.ts. */
  removed: string[];
  /** Keys whose declared secrets/config are still unset. */
  needsSetup: string[];
}

export const catalogKey = (kind: CatalogKind, id: string): string => `${kind}:${id}`;

/** Newer-than comparison over dotted numeric versions. Non-numeric segments
 *  compare as 0, so a malformed version never reports an update — failing
 *  closed is right here: a spurious update badge invites a pointless install. */
function isNewer(available: string, installed: string): boolean {
  const a = available.split('.').map((s) => Number.parseInt(s, 10) || 0);
  const b = installed.split('.').map((s) => Number.parseInt(s, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export function mergeCatalog(args: MergeCatalogArgs): CatalogItem[] {
  const removed = new Set(args.removed);
  const needsSetup = new Set(args.needsSetup);
  const items = new Map<string, CatalogItem>();

  const put = (item: CatalogItem) => { items.set(item.key, item); };

  // 1. Compile-time tables. A built-in that is not first-party is a bundle
  //    target: it reads as installed today because its code ships, and a
  //    migration wave later replaces this entry with a real bundle.
  for (const [id, meta] of Object.entries(args.tileMeta) as [string, TileMeta][]) {
    const key = catalogKey('tile', id);
    put({
      key, kind: 'tile', id,
      name: meta.label, description: meta.description, category: meta.category,
      source: isFirstParty('tile', id) ? 'first-party' : 'bundle',
      installed: true, installedVersion: null, availableVersion: null, updateAvailable: false,
      permissions: [], needsSetup: needsSetup.has(key), downloads: null, brokenReason: null,
    });
  }
  for (const s of args.vizStyles) {
    const key = catalogKey('visualizer', s.id);
    put({
      key, kind: 'visualizer', id: s.id,
      name: s.label, description: s.desc, category: s.category,
      source: isFirstParty('visualizer', s.id) ? 'first-party' : 'bundle',
      installed: true, installedVersion: null, availableVersion: null, updateAvailable: false,
      permissions: [], needsSetup: needsSetup.has(key), downloads: null, brokenReason: null,
    });
  }

  // 2. Installed folders. A folder overwrites the compile-time entry of the
  //    same id — that is the migrated-item rule, and it is what makes a
  //    migration wave a no-op for this UI.
  const installedFolder = (
    kind: CatalogKind,
    f: InstalledTileFolder | InstalledVizFolder,
    fallbackCategory: TileCategory | VizCategory,
  ) => {
    if (f.source !== 'marketplace') return; // a local draft is not catalog content
    const key = catalogKey(kind, f.id);
    if (removed.has(key)) return;
    const prev = items.get(key);
    put({
      key, kind, id: f.id,
      name: f.name.trim() || f.id,
      description: f.author ? `by ${f.author}` : prev?.description ?? '',
      category: prev?.category ?? fallbackCategory,
      source: 'bundle',
      installed: true,
      installedVersion: f.version,
      availableVersion: prev?.availableVersion ?? null,
      updateAvailable: false,
      permissions: prev?.permissions ?? [],
      needsSetup: needsSetup.has(key),
      downloads: prev?.downloads ?? null,
      brokenReason: f.manifest_error,
    });
  };
  for (const f of args.installedTiles) installedFolder('tile', f, 'integrations');
  for (const f of args.installedViz) installedFolder('visualizer', f, 'ambient');

  // 3. The signed index. Adds items nobody has installed, and supplies the
  //    available version, permissions and download count for those they do.
  for (const b of args.index) {
    if (b.kind === 'preset') continue; // presets are data, not catalog content
    const kind: CatalogKind = b.kind;
    const key = catalogKey(kind, b.id);
    const prev = items.get(key);
    const installed = prev?.installedVersion != null;
    put({
      key, kind, id: b.id,
      name: b.name || prev?.name || b.id,
      description: prev?.description ?? (b.author ? `by ${b.author}` : ''),
      category: prev?.category ?? (kind === 'tile' ? 'integrations' : 'ambient'),
      source: 'bundle',
      installed,
      installedVersion: prev?.installedVersion ?? null,
      availableVersion: b.version,
      updateAvailable: installed && isNewer(b.version, prev!.installedVersion!),
      permissions: b.permissions,
      needsSetup: needsSetup.has(key),
      downloads: b.downloads,
      brokenReason: prev?.brokenReason ?? null,
    });
  }

  // 4. Removal. Applied last so an item the user removed is dropped when it is
  //    only local, but stays browsable (uninstalled) when the index offers it.
  const out: CatalogItem[] = [];
  for (const item of items.values()) {
    if (!removed.has(item.key)) { out.push(item); continue; }
    if (item.availableVersion != null) {
      out.push({ ...item, installed: false, installedVersion: null, updateAvailable: false });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app && npm test`
Expected: PASS. New total: 348 (337 + 11).

- [ ] **Step 5: Commit**

```bash
git add app/src/state/catalog.ts app/src/state/catalog.test.ts
git commit -m "feat(catalog): unified catalog merge over tables, folders, index and removals"
```

---

### Task 3: Removal persistence and enforcement

**Files:**
- Create: `app/src/state/removedContent.ts`
- Test: `app/src/state/removedContent.test.ts`
- Modify: `app/src/components/useVizStyles.ts`
- Modify: `app/src/tiles/useTileCatalog.ts`

**Interfaces:**
- Consumes: `catalogKey` (Task 2), the existing `useTweaks` store.
- Produces: `applyRemovals(keys, items, kind)` (pure), and the `useRemovedContent()` hook returning `{ removed, remove, restore, restoreAll }`.

**Why the tweaks store, not localStorage:** `catalog.removed` is a content choice, so it should travel with settings export/import and come back with a restored backup. `tweaks.rs` already persists a single JSON blob atomically.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/state/removedContent.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRemovals } from './removedContent';

test('applyRemovals: drops matching ids for the given kind', () => {
  const out = applyRemovals(['visualizer:bars'], [{ id: 'bars' }, { id: 'radial' }], 'visualizer');
  assert.deepEqual(out.map((s) => s.id), ['radial']);
});

test('applyRemovals: a tile removal does not affect a visualizer of the same id', () => {
  const out = applyRemovals(['tile:vinyl'], [{ id: 'vinyl' }], 'visualizer');
  assert.deepEqual(out.map((s) => s.id), ['vinyl']);
});

test('applyRemovals: strips the bundle: prefix before matching', () => {
  const out = applyRemovals(['visualizer:aurora'], [{ id: 'bundle:aurora' }], 'visualizer');
  assert.deepEqual(out, []);
});

test('applyRemovals: an empty removal list is identity', () => {
  const input = [{ id: 'bars' }, { id: 'radial' }];
  assert.deepEqual(applyRemovals([], input, 'visualizer'), input);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx tsx --test src/state/removedContent.test.ts`
Expected: FAIL — `Cannot find module './removedContent'`.

- [ ] **Step 3: Write the pure helper and the hook**

```ts
// app/src/state/removedContent.ts
// ─────────────────────────────────────────────────────────────────────────────
// The single "user does not want this" list, keyed `${kind}:${id}`.
//
// One list covers both backings. A bundle removal needs a tombstone even
// though its folder is already gone, otherwise the next seed sync reinstalls
// it — which is exactly the bug this list exists to prevent.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback } from 'react';
import { useTweaks } from './useTweaks';
import { catalogKey, type CatalogKind } from './catalog';

const BUNDLE_PREFIX = 'bundle:';

/** Filters a list of `{id}` entries against removal keys of one kind.
 *  Accepts both bare ids and `bundle:<id>` forms, since the V-cycle and tile
 *  catalog use the prefixed form while the removal list never does. */
export function applyRemovals<T extends { id: string }>(
  removed: string[],
  items: T[],
  kind: CatalogKind,
): T[] {
  if (removed.length === 0) return items;
  const drop = new Set(removed);
  return items.filter((it) => {
    const bare = it.id.startsWith(BUNDLE_PREFIX) ? it.id.slice(BUNDLE_PREFIX.length) : it.id;
    return !drop.has(catalogKey(kind, bare));
  });
}

export function useRemovedContent() {
  const [tweaks, setTweaks] = useTweaks();
  const removed: string[] = Array.isArray(tweaks.catalogRemoved) ? tweaks.catalogRemoved : [];

  const remove = useCallback((key: string) => {
    setTweaks((t) => {
      const cur: string[] = Array.isArray(t.catalogRemoved) ? t.catalogRemoved : [];
      return cur.includes(key) ? t : { ...t, catalogRemoved: [...cur, key] };
    });
  }, [setTweaks]);

  const restore = useCallback((key: string) => {
    setTweaks((t) => {
      const cur: string[] = Array.isArray(t.catalogRemoved) ? t.catalogRemoved : [];
      return { ...t, catalogRemoved: cur.filter((k) => k !== key) };
    });
  }, [setTweaks]);

  const restoreAll = useCallback(() => {
    setTweaks((t) => ({ ...t, catalogRemoved: [] }));
  }, [setTweaks]);

  return { removed, remove, restore, restoreAll };
}
```

**Note on `useTweaks`'s actual signature:** read `app/src/state/useTweaks.ts` first. If it exposes an object API rather than a `[state, setState]` tuple, adapt the three callbacks to it — do not change `useTweaks` itself. The pure `applyRemovals` above is what the tests cover and must not change shape.

- [ ] **Step 4: Enforce removals in the pickers**

In `app/src/components/useVizStyles.ts`, wrap the merged result:

```ts
const { removed } = useRemovedContent();
const styles = useMemo(
  () => applyRemovals(removed, mergeVizStyles(BUILTIN_VIZ_STYLES, folders), 'visualizer'),
  [removed, folders],
);
```

Do the same in `app/src/tiles/useTileCatalog.ts` with `'tile'`, filtering the `TileEntry[]` — note `TileEntry` keys on `type`, not `id`, so map it: `applyRemovals(removed, entries.map((e) => ({ ...e, id: e.type })), 'tile')`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd app && npm test && npx tsc -b --noEmit`
Expected: PASS. New total: 352 (348 + 4).

- [ ] **Step 6: Commit**

```bash
git add app/src/state/removedContent.ts app/src/state/removedContent.test.ts app/src/components/useVizStyles.ts app/src/tiles/useTileCatalog.ts
git commit -m "feat(catalog): persist removals in the tweaks store and enforce them in pickers"
```

---

### Task 4: Extract the install core in Rust

**Files:**
- Modify: `app/src-tauri/src/marketplace.rs`

**Interfaces:**
- Produces: `pub fn install_bundle_zip<R: Runtime>(app: &AppHandle<R>, kind: &str, id: &str, version: &str, zip: &[u8], origin: &str) -> Result<(), String>`.

This is a pure refactor: no behaviour change, so the existing cargo tests are the regression gate. `marketplace_install` keeps doing the network fetch and the sha256 check, then delegates extraction to the new function. Task 5 and Task 6 both call it.

- [ ] **Step 1: Run the existing tests to establish the baseline**

Run: `cd app/src-tauri && cargo test`
Expected: PASS, 41 tests. Record the number.

- [ ] **Step 2: Extract the function**

In `marketplace.rs`, move everything after the sha256 verification — the zip open, the entry allowlist loop, the manifest validation, the directory write and the `installed.json` write — into:

```rust
/// Extracts a verified bundle zip into the install directory.
///
/// The ONLY path that writes bundle content to disk. Seeded and downloaded
/// bundles both come through here so neither can skip the entry allowlist or
/// the manifest validation — a hand-copy into %APPDATA% is what shipped
/// uninstallable tiles at 1.0.0.
///
/// `origin` is recorded in installed.json as "seed" or "marketplace".
pub fn install_bundle_zip<R: Runtime>(
    app: &AppHandle<R>,
    kind: &str,
    id: &str,
    version: &str,
    zip: &[u8],
    origin: &str,
) -> Result<(), String> {
    // ... body moved verbatim from marketplace_install ...
}
```

Keep the allowlist exactly as it is. Add `origin` to the `installed.json` object alongside the fields it already writes; `marketplace_install` passes `"marketplace"`.

- [ ] **Step 3: Add a test that the allowlist still rejects a stray entry**

```rust
#[test]
fn install_rejects_unexpected_zip_entry() {
    // Build a zip containing an entry that is not in the allowlist.
    let mut buf = Vec::new();
    {
        let mut w = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
        let opts = zip::write::FileOptions::default();
        w.start_file("manifest.json", opts).unwrap();
        use std::io::Write;
        w.write_all(br#"{"id":"x","name":"X","version":"1.0.0","api":1,"permissions":[]}"#).unwrap();
        w.start_file("installed.json", opts).unwrap();
        w.write_all(b"{}").unwrap();
        w.finish().unwrap();
    }
    let err = entries_of(&buf).unwrap_err();
    assert!(err.contains("unexpected file"), "got: {err}");
}
```

If the allowlist check is inline rather than in a helper, extract it as `fn entries_of(zip: &[u8]) -> Result<HashMap<String, Vec<u8>>, String>` while doing this task and have `install_bundle_zip` call it — that is what makes it testable without an `AppHandle`.

- [ ] **Step 4: Run the tests**

Run: `cd app/src-tauri && cargo test`
Expected: PASS, 42 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src-tauri/src/marketplace.rs
git commit -m "refactor(marketplace): extract install_bundle_zip as the single write path"
```

---

### Task 5: Seed resources and seed_sync

**Files:**
- Create: `app/src-tauri/src/seed.rs`
- Modify: `app/src-tauri/src/lib.rs` (register module + command)
- Modify: `app/src-tauri/tauri.conf.json` (bundle resources)
- Create: `app/src-tauri/resources/seed/.gitkeep`

**Interfaces:**
- Consumes: `install_bundle_zip` (Task 4).
- Produces: `#[tauri::command] pub fn seed_sync(app, removed: Vec<String>) -> Result<Vec<String>, String>` returning the keys it installed; `pub fn seed_zip_for(app, kind, id, version) -> Option<Vec<u8>>` used by Task 6.

- [ ] **Step 1: Write the failing test**

```rust
// in app/src-tauri/src/seed.rs
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seed_filename_parses_kind_id_version() {
        let p = std::path::Path::new("visualizer/aurora-1.0.0.zip");
        let s = parse_seed_path(p).unwrap();
        assert_eq!(s.kind, "visualizer");
        assert_eq!(s.id, "aurora");
        assert_eq!(s.version, "1.0.0");
    }

    #[test]
    fn seed_filename_rejects_unsafe_id() {
        assert!(parse_seed_path(std::path::Path::new("visualizer/../etc-1.0.0.zip")).is_none());
        assert!(parse_seed_path(std::path::Path::new("visualizer/A B-1.0.0.zip")).is_none());
    }

    #[test]
    fn seed_filename_rejects_unknown_kind() {
        assert!(parse_seed_path(std::path::Path::new("preset/x-1.0.0.zip")).is_none());
    }

    #[test]
    fn removed_keys_are_skipped() {
        let removed = vec!["visualizer:aurora".to_string()];
        assert!(should_skip(&removed, "visualizer", "aurora"));
        assert!(!should_skip(&removed, "tile", "aurora"));
        assert!(!should_skip(&removed, "visualizer", "liquid"));
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/src-tauri && cargo test seed`
Expected: FAIL — module `seed` does not exist.

- [ ] **Step 3: Write the implementation**

```rust
// app/src-tauri/src/seed.rs
//! Ships the base content set as real bundles and installs them on first run.
//!
//! The point of seeding is that "official" content stops being a privileged
//! tier: it is ordinary bundle content that merely happens to arrive with the
//! app. Removal therefore deletes it like anything else, and reinstalling it
//! works with no network because the zip is still in resources.
//!
//! Seeds get NO privileged install path — they go through
//! `marketplace::install_bundle_zip`, the same allowlist and validation as a
//! download.

use crate::marketplace::install_bundle_zip;
use std::path::Path;
use tauri::{AppHandle, Manager, Runtime};

pub struct SeedRef {
    pub kind: String,
    pub id: String,
    pub version: String,
}

fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// `<kind>/<id>-<version>.zip`. Splits on the LAST '-' so an id containing a
/// hyphen (`tile-quote`) parses correctly.
pub fn parse_seed_path(p: &Path) -> Option<SeedRef> {
    let kind = p.parent()?.file_name()?.to_str()?;
    if kind != "tile" && kind != "visualizer" {
        return None;
    }
    let stem = p.file_stem()?.to_str()?;
    let (id, version) = stem.rsplit_once('-')?;
    if !is_safe_id(id) || version.is_empty() {
        return None;
    }
    Some(SeedRef { kind: kind.to_string(), id: id.to_string(), version: version.to_string() })
}

pub fn should_skip(removed: &[String], kind: &str, id: &str) -> bool {
    let key = format!("{kind}:{id}");
    removed.iter().any(|r| r == &key)
}

fn seed_dir<R: Runtime>(app: &AppHandle<R>) -> Option<std::path::PathBuf> {
    app.path().resource_dir().ok().map(|d| d.join("resources/seed"))
}

/// Returns the seed zip bytes for an exact id@version, if one ships.
pub fn seed_zip_for<R: Runtime>(
    app: &AppHandle<R>, kind: &str, id: &str, version: &str,
) -> Option<Vec<u8>> {
    if !is_safe_id(id) {
        return None;
    }
    let dir = seed_dir(app)?;
    std::fs::read(dir.join(kind).join(format!("{id}-{version}.zip"))).ok()
}

/// Installs every seed bundle that is not already installed and not in
/// `removed`. Non-fatal: a failure on one seed is logged and the rest proceed.
/// Returns the keys installed.
#[tauri::command]
pub fn seed_sync<R: Runtime>(app: AppHandle<R>, removed: Vec<String>) -> Result<Vec<String>, String> {
    let Some(dir) = seed_dir(&app) else { return Ok(vec![]) };
    let mut installed = Vec::new();
    for kind in ["tile", "visualizer"] {
        let Ok(entries) = std::fs::read_dir(dir.join(kind)) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(s) = parse_seed_path(&path) else { continue };
            if should_skip(&removed, &s.kind, &s.id) {
                continue;
            }
            if crate::marketplace::is_installed(&app, &s.kind, &s.id) {
                continue;
            }
            let Ok(bytes) = std::fs::read(&path) else { continue };
            match install_bundle_zip(&app, &s.kind, &s.id, &s.version, &bytes, "seed") {
                Ok(()) => installed.push(format!("{}:{}", s.kind, s.id)),
                Err(e) => eprintln!("seed_sync: {}:{} failed: {e}", s.kind, s.id),
            }
        }
    }
    Ok(installed)
}
```

Add `pub fn is_installed<R: Runtime>(app: &AppHandle<R>, kind: &str, id: &str) -> bool` to `marketplace.rs` — it checks whether the install directory for that kind/id exists and contains `installed.json`.

- [ ] **Step 4: Register the module and command**

In `lib.rs`: add `mod seed;` and add `seed::seed_sync` to the `invoke_handler` list.

In `tauri.conf.json`, under `bundle`, add:

```json
"resources": ["resources/seed/**/*"]
```

- [ ] **Step 5: Run the tests**

Run: `cd app/src-tauri && cargo test`
Expected: PASS, 46 tests.

- [ ] **Step 6: Commit**

```bash
git add app/src-tauri/src/seed.rs app/src-tauri/src/lib.rs app/src-tauri/src/marketplace.rs app/src-tauri/tauri.conf.json app/src-tauri/resources/seed/.gitkeep
git commit -m "feat(seed): install app-shipped seed bundles through the real install path"
```

---

### Task 6: Offline reinstall via seed fallback

**Files:**
- Modify: `app/src-tauri/src/marketplace.rs`

**Interfaces:**
- Consumes: `seed_zip_for` (Task 5).

- [ ] **Step 1: Write the failing test**

```rust
#[test]
fn seed_fallback_only_applies_to_an_exact_version_match() {
    // seed_zip_for is keyed on id AND version: a seeded 1.0.0 must not satisfy
    // a request for 1.1.0, or a user would silently get stale content when the
    // network blips during an update.
    assert_eq!(seed_lookup_name("aurora", "1.0.0"), "aurora-1.0.0.zip");
    assert_ne!(seed_lookup_name("aurora", "1.1.0"), "aurora-1.0.0.zip");
}
```

Add `pub fn seed_lookup_name(id: &str, version: &str) -> String { format!("{id}-{version}.zip") }` to `seed.rs` and use it in `seed_zip_for`, so the naming rule has one definition and a test.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/src-tauri && cargo test seed_fallback`
Expected: FAIL — `seed_lookup_name` not found.

- [ ] **Step 3: Wire the fallback into marketplace_install**

In `marketplace_install`, when the HTTP fetch returns an error, before giving up:

```rust
let zip = match fetch_bundle(&url, &id, &version) {
    Ok(bytes) => bytes,
    Err(net_err) => match crate::seed::seed_zip_for(&app, &kind, &id, &version) {
        Some(bytes) => bytes,
        None => return Err(net_err),
    },
};
```

The sha256 check still runs on whatever bytes came back. A seed whose hash does not match the index entry fails exactly like a corrupted download — the verification is not skipped for seeds.

- [ ] **Step 4: Run the tests**

Run: `cd app/src-tauri && cargo test`
Expected: PASS, 47 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src-tauri/src/marketplace.rs app/src-tauri/src/seed.rs
git commit -m "feat(marketplace): fall back to a seed copy when the network install fails"
```

---

### Task 7: Build the seed zips

**Files:**
- Modify: `scripts/bundles.mjs` (repo root, invoked from `app/` as `../scripts/bundles.mjs`)
- Modify: `app/package.json` (add `bundles:seed` script)

- [ ] **Step 1: Add the seed command**

Extend `scripts/bundles.mjs` with a `seed` verb that, for every directory in `bundles/`, produces `app/src-tauri/resources/seed/<kind>/<id>-<version>.zip` using the SAME zip-building code the `build` verb already uses. `kind` and `version` come from each bundle's `manifest.json`. Delete stale zips for an id whose version changed, so the resources directory never holds two versions of one id.

- [ ] **Step 2: Add the npm script**

In `app/package.json`:

```json
"bundles:seed": "node ../scripts/bundles.mjs seed"
```

- [ ] **Step 3: Run it and verify the output**

Run: `cd app && npm run bundles:seed && ls src-tauri/resources/seed/visualizer src-tauri/resources/seed/tile`
Expected: 12 visualizer zips and 3 tile zips, named `<id>-<version>.zip`.

- [ ] **Step 4: Verify a seed zip's entries match what the server ships**

Run: `cd app && node -e "const z=require('fs').readFileSync('src-tauri/resources/seed/tile/tile-quote-1.0.1.zip');console.log(z.length)"`

Then unzip one and confirm it contains `manifest.json` + `view.json` and NOT `main.js`. This is the exact check the 1.0.0 tile bug needed — a tile whose payload is named `main.js` will fail `marketplace_install`.

- [ ] **Step 5: Commit**

```bash
git add scripts/bundles.mjs app/package.json app/src-tauri/resources/seed
git commit -m "build(seed): generate seed bundle zips into tauri resources"
```

---

### Task 8: ContentLibrary shell — rail and counts

**Files:**
- Create: `app/src/components/ContentLibrary.tsx`
- Create: `app/src/components/catalogRail.ts`
- Test: `app/src/components/catalogRail.test.ts`

**Interfaces:**
- Consumes: `CatalogItem` (Task 2).
- Produces: `buildRail(items)` returning `RailSection[]`; the `ContentLibrary` component.

The rail's contents are computed by a pure function so the counts are testable without rendering.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/components/catalogRail.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRail } from './catalogRail';
import type { CatalogItem } from '../state/catalog';

const item = (o: Partial<CatalogItem> = {}): CatalogItem => ({
  key: 'tile:x', kind: 'tile', id: 'x', name: 'X', description: '', category: 'weather',
  source: 'bundle', installed: false, installedVersion: null, availableVersion: '1.0.0',
  updateAvailable: false, permissions: [], needsSetup: false, downloads: 0, brokenReason: null, ...o,
});

test('buildRail: All counts every item', () => {
  const rail = buildRail([item(), item({ key: 'tile:y', id: 'y' })]);
  assert.equal(rail.find((r) => r.id === 'all')?.count, 2);
});

test('buildRail: Installed and Updates count only what qualifies', () => {
  const rail = buildRail([
    item({ installed: true }),
    item({ key: 'tile:y', id: 'y', installed: true, updateAvailable: true }),
    item({ key: 'tile:z', id: 'z' }),
  ]);
  assert.equal(rail.find((r) => r.id === 'installed')?.count, 2);
  assert.equal(rail.find((r) => r.id === 'updates')?.count, 1);
});

test('buildRail: category rows appear per kind and omit empty categories', () => {
  const rail = buildRail([item({ category: 'weather' })]);
  assert.ok(rail.some((r) => r.id === 'tile:weather' && r.count === 1));
  assert.equal(rail.some((r) => r.id === 'tile:system'), false);
});

test('buildRail: needsSetup row counts items awaiting a credential', () => {
  const rail = buildRail([item({ installed: true, needsSetup: true })]);
  assert.equal(rail.find((r) => r.id === 'needs-setup')?.count, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx tsx --test src/components/catalogRail.test.ts`
Expected: FAIL — `Cannot find module './catalogRail'`.

- [ ] **Step 3: Write buildRail**

```ts
// app/src/components/catalogRail.ts
import type { CatalogItem, CatalogKind } from '../state/catalog';

export interface RailSection {
  id: string;
  label: string;
  count: number;
  /** Heading rows are not selectable. */
  heading?: boolean;
  match: (i: CatalogItem) => boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  media: 'Media', system: 'System', weather: 'Weather & sky',
  productivity: 'Productivity', ambient: 'Ambient', integrations: 'Integrations',
  spectrum: 'Spectrum', wave: 'Waveform', scene: 'Scenes', engine: 'Engines',
};

export function buildRail(items: CatalogItem[]): RailSection[] {
  const rows: RailSection[] = [];
  const push = (id: string, label: string, match: (i: CatalogItem) => boolean) => {
    const count = items.filter(match).length;
    if (count > 0 || id === 'all') rows.push({ id, label, count, match });
  };

  push('all', 'All', () => true);
  push('installed', 'Installed', (i) => i.installed);
  push('updates', 'Updates', (i) => i.updateAvailable);
  push('needs-setup', 'Needs setup', (i) => i.installed && i.needsSetup);

  for (const kind of ['tile', 'visualizer'] as CatalogKind[]) {
    const ofKind = items.filter((i) => i.kind === kind);
    if (ofKind.length === 0) continue;
    rows.push({
      id: `heading:${kind}`, heading: true, count: ofKind.length,
      label: kind === 'tile' ? 'Tiles' : 'Visualizers', match: () => false,
    });
    const cats = [...new Set(ofKind.map((i) => i.category))].sort();
    for (const cat of cats) {
      push(`${kind}:${cat}`, CATEGORY_LABELS[cat] ?? cat,
        (i) => i.kind === kind && i.category === cat);
    }
  }
  return rows;
}
```

- [ ] **Step 4: Build the ContentLibrary shell**

Create `ContentLibrary.tsx` rendering layout B: a fixed 104px left rail listing `buildRail` rows (headings styled as small uppercase labels, selectable rows showing `label · count`, the active row accented) and a right pane that, for now, renders the filtered item count. Wire it to the same modal frame `TileLibrary` currently uses so it can be opened from the existing entry point. Data comes from `mergeCatalog` fed by `tiles_list`, `visualizers_list`, `marketplace_fetch_index` and `useRemovedContent`.

- [ ] **Step 5: Run the tests**

Run: `cd app && npm test && npx tsc -b --noEmit`
Expected: PASS. New total: 356 (352 + 4).

- [ ] **Step 6: Commit**

```bash
git add app/src/components/ContentLibrary.tsx app/src/components/catalogRail.ts app/src/components/catalogRail.test.ts
git commit -m "feat(catalog): ContentLibrary shell with category rail and live counts"
```

---

### Task 9: Cards, grid and the install/remove actions

**Files:**
- Create: `app/src/components/CatalogCard.tsx`
- Modify: `app/src/components/ContentLibrary.tsx`

**Interfaces:**
- Consumes: `CatalogItem`, `useRemovedContent` (Task 3), the existing `marketplace_install` / `marketplace_uninstall` commands.

- [ ] **Step 1: Build the card**

`CatalogCard.tsx` renders one `CatalogItem`: a 46px preview area (placeholder block until spec C), the name, `kind · version · author` in mono, the primary action button, and state tags. Tag rules, in priority order — show at most two:

| Condition | Tag |
|---|---|
| `brokenReason != null` | `error` (red) |
| `updateAvailable` | `update` |
| `installed && needsSetup` | `needs key` (amber) |
| `source === 'first-party'` | `core` |
| `!installed && downloads === 0` | `new` |

Primary action: `Remove` when `installed`, otherwise `Install`. Both disabled while a mutation is in flight.

- [ ] **Step 2: Wire the actions**

In `ContentLibrary.tsx`:

- **Install** — for a `bundle` item with permissions, show the existing confirmation dialog (lift it out of `MarketplaceTab.tsx` unchanged), then `invoke('marketplace_install', { url, id, version, sha256, kind })`, then `restore(key)` to clear any tombstone, then refresh.
- **Remove** — for a `bundle` item that is installed, `invoke('marketplace_uninstall', { id, kind })`; for a `first-party` item, skip the invoke. In both cases call `remove(key)` **only after** a successful uninstall (or immediately for first-party), so a failed uninstall leaves state honest.
- Removing an item also removes its dashboard instances in the same action.

- [ ] **Step 3: Verify in the running app**

Run: `cd app && npm run tauri:dev`

Check, in order: the catalog opens; removing a first-party visualizer drops it from the V-cycle and the gallery; restarting the app keeps it gone; installing a marketplace visualizer makes it appear; removing an installed bundle deletes its folder under `%APPDATA%/com.secondmonitor.hub/visualizers/`.

- [ ] **Step 4: Commit**

```bash
git add app/src/components/CatalogCard.tsx app/src/components/ContentLibrary.tsx
git commit -m "feat(catalog): item cards with install and remove for both backings"
```

---

### Task 10: Search, empty states and error states

**Files:**
- Modify: `app/src/components/ContentLibrary.tsx`
- Test: `app/src/components/catalogSearch.test.ts`
- Create: `app/src/components/catalogSearch.ts`

- [ ] **Step 1: Write the failing test**

```ts
// app/src/components/catalogSearch.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { searchItems } from './catalogSearch';
import type { CatalogItem } from '../state/catalog';

const item = (name: string, description = ''): CatalogItem => ({
  key: `tile:${name}`, kind: 'tile', id: name, name, description, category: 'weather',
  source: 'bundle', installed: false, installedVersion: null, availableVersion: '1.0.0',
  updateAvailable: false, permissions: [], needsSetup: false, downloads: 0, brokenReason: null,
});

test('searchItems: matches name case-insensitively', () => {
  assert.equal(searchItems([item('Aurora')], 'aur').length, 1);
});

test('searchItems: matches description', () => {
  assert.equal(searchItems([item('X', 'spinning record')], 'record').length, 1);
});

test('searchItems: an empty query is identity', () => {
  const items = [item('A'), item('B')];
  assert.deepEqual(searchItems(items, '   '), items);
});

test('searchItems: no match yields an empty list', () => {
  assert.deepEqual(searchItems([item('Aurora')], 'zzz'), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx tsx --test src/components/catalogSearch.test.ts`
Expected: FAIL — `Cannot find module './catalogSearch'`.

- [ ] **Step 3: Implement search**

```ts
// app/src/components/catalogSearch.ts
import type { CatalogItem } from '../state/catalog';

export function searchItems(items: CatalogItem[], query: string): CatalogItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter(
    (i) => i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q),
  );
}
```

- [ ] **Step 4: Add the three states to ContentLibrary**

- **Index unreachable** — `mergeCatalog` already renders from tables plus disk when `index` is `[]`. Show an inline notice, `marketplace unreachable — showing local content`, with a Retry button. It must not be a red error and must not replace the grid. This is the fix for the failure observed on 2026-07-30 after a cold boot.
- **Search finds nothing in the current slice** — offer "search all content", which switches the rail to `all` and keeps the query.
- **Everything removed** — the grid shows an empty state with a **Restore defaults** button calling `restoreAll()` then `seed_sync`.

- [ ] **Step 5: Run the tests**

Run: `cd app && npm test && npx tsc -b --noEmit`
Expected: PASS. New total: 360 (356 + 4).

- [ ] **Step 6: Commit**

```bash
git add app/src/components/catalogSearch.ts app/src/components/catalogSearch.test.ts app/src/components/ContentLibrary.tsx
git commit -m "feat(catalog): search, offline notice and restore-defaults empty state"
```

---

### Task 11: Retire the three old surfaces

**Files:**
- Delete: `app/src/components/TileLibrary.tsx`
- Delete: `app/src/components/MarketplaceTab.tsx`
- Modify: `app/src/App.tsx`
- Modify: `app/src/components/settings.tsx`
- Modify: `app/src/components/viz.tsx` (gallery entry point)

- [ ] **Step 1: Move the server config into Settings**

Add a **Marketplace** section to Settings holding the server URL and pinned pubkey editor lifted verbatim from `MarketplaceTab.tsx`, including the `https://` and 64-hex validation and the "Use official server" reset. Keep reading and writing the same `marketplace.url` / `marketplace.pubkey` localStorage keys so existing overrides survive.

- [ ] **Step 2: Repoint every entry point**

Replace `TileLibrary` and `MarketplaceTab` usages in `App.tsx` with `ContentLibrary`. Point the viz gallery's "browse styles" affordance at `ContentLibrary` filtered to `visualizer`. Keep the keyboard shortcut that opens the library.

- [ ] **Step 3: Delete the dead files and their now-unused imports**

Delete both components. `validateManifest` is re-exported from `MarketplaceTab.tsx` — move that re-export to `ContentLibrary.tsx` or have consumers import from `sandbox/manifest` directly, whichever leaves fewer indirections.

- [ ] **Step 4: Verify nothing references the deleted modules**

Run: `cd app && npx tsc -b --noEmit && npm test`
Expected: clean, 360 tests.

- [ ] **Step 5: Verify in the running app**

Run: `cd app && npm run tauri:dev`
Check: the library opens from its old shortcut, Settings → Marketplace edits the server, and pointing at a bad URL surfaces the validation error.

- [ ] **Step 6: Commit**

```bash
git add -A app/src
git commit -m "refactor(catalog): retire TileLibrary and MarketplaceTab for ContentLibrary"
```

---

### Task 12: Collapse the duplicated tiles

**Files:**
- Delete: `app/src/components/QuoteTile.tsx`, `app/src/components/WordOfDayTile.tsx`, `app/src/components/DailyChallengeTile.tsx`
- Modify: `app/src/state/tileMeta.ts`, `app/src/state/layout.ts`, `app/src/components/tiles.tsx` (renderTile dispatch)
- Test: `app/src/state/layout.test.ts`

`quote`, `wordOfDay` and `dailyChallenge` ship as built-in tiles AND as published bundles (`tile-quote`, `tile-dictionary`, `tile-dailychallenge`), so users see duplicates today. The bundles are the survivors.

- [ ] **Step 1: Write the failing test**

```ts
// in app/src/state/layout.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { remapRetiredTileType } from './layout';

test('remapRetiredTileType: retired built-ins point at their bundle ids', () => {
  assert.equal(remapRetiredTileType('quote'), 'bundle:tile-quote');
  assert.equal(remapRetiredTileType('wordOfDay'), 'bundle:tile-dictionary');
  assert.equal(remapRetiredTileType('dailyChallenge'), 'bundle:tile-dailychallenge');
});

test('remapRetiredTileType: a live built-in is unchanged', () => {
  assert.equal(remapRetiredTileType('mixer'), 'mixer');
});

test('remapRetiredTileType: an already-bundle type is unchanged', () => {
  assert.equal(remapRetiredTileType('bundle:tile-quote'), 'bundle:tile-quote');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx tsx --test src/state/layout.test.ts`
Expected: FAIL — `remapRetiredTileType` is not exported.

- [ ] **Step 3: Implement the remap**

In `layout.ts`, mirroring `remapRetiredVizMode` in `contentRegistry.ts`:

```ts
/** Built-in tiles that moved to the marketplace. A saved layout naming one is
 *  rewritten to its bundle id on load, so an existing dashboard keeps working
 *  the moment the bundle is installed — and falls back to MissingTileCard
 *  until it is. */
const RETIRED_TILE_TYPES: Record<string, string> = {
  quote: 'bundle:tile-quote',
  wordOfDay: 'bundle:tile-dictionary',
  dailyChallenge: 'bundle:tile-dailychallenge',
};

export function remapRetiredTileType(type: string): string {
  return RETIRED_TILE_TYPES[type] ?? type;
}
```

Apply it wherever a saved layout is loaded, next to the existing `remapRetiredVizMode` call.

- [ ] **Step 4: Remove the built-ins**

Delete the three components, their `TILE_META` entries, their `ALL_TILE_TYPES` entries, their default rects and their `renderTile` cases. The compiler enforces completeness of `Record<BuiltinTileType, …>`, so any missed site is a build error rather than a runtime blank.

- [ ] **Step 5: Run the tests**

Run: `cd app && npm test && npx tsc -b --noEmit`
Expected: PASS, 363 tests. Note `firstParty.test.ts` still passes — none of the three is first-party.

- [ ] **Step 6: Verify the upgrade path in the running app**

Run: `cd app && npm run tauri:dev`
Place a Quote tile before upgrading (or hand-edit a saved layout to contain `"type":"quote"`), then load: it must render the installed `tile-quote` bundle, or a `MissingTileCard` offering to install it — never a blank.

- [ ] **Step 7: Commit**

```bash
git add -A app/src
git commit -m "refactor(tiles): retire the three built-ins that shipped as bundles"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §2.1 first-party set | 1 |
| §3 catalog model | 2 |
| §4 removal + tombstones + restore defaults | 3, 9, 10 |
| §5 seeding, real install path, offline fallback | 4, 5, 6, 7 |
| §6 UI (rail, grid, search, server config move) | 8, 9, 10, 11 |
| §7 error handling | 9, 10 |
| §8 duplicate collapse | 12 |
| §9 testing | every task |

**Known gaps, deliberate:** preview thumbnails are placeholder blocks (spec C), and `mergeCatalog` accepts `needsSetup` as an input rather than computing it — the credential-state logic lives in `TileCredentialPanel` and Task 9 passes it in. Neither is a placeholder in the plan sense; both are scoped out in spec §10.

**Type consistency:** `catalogKey`, `CatalogItem`, `CatalogKind`, `CatalogSource`, `mergeCatalog`, `MergeCatalogArgs`, `IndexBundle`, `applyRemovals`, `useRemovedContent`, `buildRail`, `RailSection`, `searchItems`, `install_bundle_zip`, `seed_zip_for`, `seed_lookup_name`, `seed_sync`, `should_skip`, `parse_seed_path`, `is_installed`, `remapRetiredTileType` — each is defined in exactly one task and used with the same signature everywhere after.

**Test totals:** frontend 332 → 363; cargo 41 → 47.
