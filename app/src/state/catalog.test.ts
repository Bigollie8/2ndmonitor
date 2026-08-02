import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeCatalog, catalogKey, planRemoval, restoreDefaults, secretSetupCandidates, applyOptimisticVote,
  type MergeCatalogArgs, type IndexBundle, type InstalledPresetFolder,
} from './catalog';
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
const presetFolder = (o: Partial<InstalledPresetFolder> = {}): InstalledPresetFolder => ({
  id: 'tron-grid', name: 'Tron Grid', author: 'oli***', version: '1.0.0', ...o,
});
const idx = (o: Record<string, unknown> = {}) => ({
  id: 'aurora', version: '1.0.0', kind: 'visualizer', name: 'Aurora',
  author: 'oli***', permissions: [], sha256: 'ab', size: 100, downloads: 40, ...o,
});
const presetIdx = (o: Record<string, unknown> = {}) => ({
  id: 'tron-grid', version: '1.0.0', kind: 'preset', name: 'Tron Grid',
  author: 'oli***', permissions: [], sha256: 'ab', size: 100, downloads: 40, ...o,
});

const base = (o: Partial<MergeCatalogArgs> = {}): MergeCatalogArgs => ({
  tileMeta: TILE_META, vizStyles: BUILTIN_VIZ_STYLES,
  installedTiles: [], installedViz: [], installedPresets: [], index: [], removed: [], needsSetup: [], ratings: {},
  ...o,
});

test('mergeCatalog: built-ins appear as first-party or bundle-target items', () => {
  const out = mergeCatalog(base());
  const mixer = out.find((i) => i.key === 'tile:mixer');
  assert.ok(mixer);
  assert.equal(mixer.source, 'first-party');
  assert.equal(mixer.installed, true);

  // `weatherRadar` is a tile-side bundle target: a compile-time entry that
  // ships and works today, which a migration wave later replaces with a folder.
  const radar = out.find((i) => i.key === 'tile:weatherRadar');
  assert.ok(radar);
  assert.equal(radar.source, 'bundle');
  assert.equal(radar.installed, true, 'a not-yet-migrated built-in still reads as installed');

  // Every built-in visualizer style is now first-party: the fifteen that were
  // bundle targets migrated out of BUILTIN_VIZ_STYLES entirely, leaving only
  // the two engines.
  const milkdrop = out.find((i) => i.key === 'visualizer:milkdrop');
  assert.ok(milkdrop);
  assert.equal(milkdrop.source, 'first-party');
  assert.equal(milkdrop.installed, true);
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

test('mergeCatalog: a table-only built-in that also has an index entry stays installed, no update', () => {
  // `milkdrop` is a built-in with no installed folder — it ships and works
  // today even if the marketplace also lists it. It must not flip to "Install".
  const out = mergeCatalog(base({ index: [idx({ id: 'milkdrop', kind: 'visualizer', version: '1.1.0' })] }));
  const milkdrop = out.find((i) => i.key === 'visualizer:milkdrop');
  assert.ok(milkdrop);
  assert.equal(milkdrop.installed, true);
  assert.equal(milkdrop.updateAvailable, false, 'no installedVersion to compare against, so no update badge');
});

test('mergeCatalog: an index-only item (no table entry, no folder) is installed: false', () => {
  const out = mergeCatalog(base({ index: [idx({ id: 'liquid', name: 'Liquid' })] }));
  assert.equal(out.find((i) => i.key === 'visualizer:liquid')?.installed, false);
});

test('mergeCatalog: a malformed available version never flags an update (fails closed)', () => {
  const out = mergeCatalog(base({
    installedViz: [vizFolder({ version: '1.0.0' })],
    index: [idx({ version: '1.x.0' })],
  }));
  assert.equal(out.find((i) => i.key === 'visualizer:aurora')?.updateAvailable, false);
});

test('mergeCatalog: a removed key stays in the output, flagged removed — not dropped', () => {
  // Critical 2 (whole-branch review): dropping a removed item entirely left
  // it with no name/category to render in a "Removed" recovery view — the
  // only survivors were the ~15 published bundles (see the next test). Every
  // OTHER removed item (most first-party tiles, every not-yet-migrated
  // built-in visualizer style) simply vanished with no way back.
  const out = mergeCatalog(base({ removed: ['tile:mixer', 'visualizer:milkdrop'] }));
  const mixer = out.find((i) => i.key === 'tile:mixer');
  const milkdrop = out.find((i) => i.key === 'visualizer:milkdrop');
  assert.ok(mixer, 'stays in the output so the Removed rail row has a name to show');
  assert.ok(milkdrop);
  assert.equal(mixer.removed, true);
  assert.equal(milkdrop.removed, true);
  assert.equal(mixer.installed, false);
  assert.equal(mixer.installedVersion, null);
  assert.equal(mixer.updateAvailable, false);
});

test('mergeCatalog: a non-removed item is flagged removed: false', () => {
  const out = mergeCatalog(base());
  assert.equal(out.find((i) => i.key === 'tile:mixer')?.removed, false);
});

test('mergeCatalog: a removed key still listed in the index is available again', () => {
  const out = mergeCatalog(base({ removed: ['visualizer:aurora'], index: [idx()] }));
  const a = out.find((i) => i.key === 'visualizer:aurora');
  assert.ok(a, 'removed content stays browsable so it can be reinstalled');
  assert.equal(a.installed, false);
  assert.equal(a.removed, true);
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

// rating — carried through all four merge passes, per bare bundle id (not
// catalogKey). See MergeCatalogArgs.ratings' doc comment for why the lookup
// key differs from every other index-sourced field.

test('mergeCatalog pass 1: a compile-time table entry has no rating', () => {
  const out = mergeCatalog(base());
  assert.equal(out.find((i) => i.key === 'tile:mixer')?.rating, null);
});

test('mergeCatalog pass 2: an installed folder with no index entry has no rating', () => {
  const out = mergeCatalog(base({ installedViz: [vizFolder()] }));
  assert.equal(out.find((i) => i.key === 'visualizer:aurora')?.rating, null);
});

test('mergeCatalog: an installed AND indexed item gets its rating from the index (pass 3 runs after pass 2)', () => {
  // Exercises pass 2's `prev?.rating ?? null` fallback (always null in
  // practice, since pass 1 never sets a rating — same as `downloads`'
  // identical fallback there) and then pass 3 overwriting it from the
  // ratings map, in one call.
  const out = mergeCatalog(base({
    installedViz: [vizFolder()],
    index: [idx()],
    ratings: { aurora: { avg: 4.5, count: 8 } },
  }));
  assert.deepEqual(out.find((i) => i.key === 'visualizer:aurora')?.rating, { avg: 4.5, count: 8 });
});

test('mergeCatalog pass 3: an index entry supplies the rating for its bare bundle id', () => {
  const out = mergeCatalog(base({
    index: [idx({ id: 'liquid', name: 'Liquid' })],
    ratings: { liquid: { avg: 4.2, count: 17 } },
  }));
  const liquid = out.find((i) => i.key === 'visualizer:liquid');
  assert.deepEqual(liquid?.rating, { avg: 4.2, count: 17 });
});

test('mergeCatalog pass 3: an id absent from the ratings map is null, not zero', () => {
  const out = mergeCatalog(base({ index: [idx({ id: 'liquid', name: 'Liquid' })], ratings: {} }));
  assert.equal(out.find((i) => i.key === 'visualizer:liquid')?.rating, null);
});

test('mergeCatalog: a failed ratings fetch ({}) leaves every item\'s rating null, catalog otherwise unaffected', () => {
  const withRatings = mergeCatalog(base({
    index: [idx({ id: 'liquid', name: 'Liquid' })],
    ratings: { liquid: { avg: 5, count: 1 } },
  }));
  const withoutRatings = mergeCatalog(base({
    index: [idx({ id: 'liquid', name: 'Liquid' })],
    ratings: {},
  }));
  assert.equal(withoutRatings.find((i) => i.key === 'visualizer:liquid')?.rating, null);
  // Every other field is identical whether or not ratings resolved — the
  // silent-failure contract from PreviewImage/previewCache.ts applies here
  // too: a missing rating changes nothing else about the item.
  const a = withRatings.find((i) => i.key === 'visualizer:liquid');
  const b = withoutRatings.find((i) => i.key === 'visualizer:liquid');
  assert.deepEqual({ ...a, rating: null }, b);
});

test('mergeCatalog pass 4: a removed item still carries its rating — not dropped', () => {
  const out = mergeCatalog(base({
    index: [idx({ id: 'liquid', name: 'Liquid' })],
    removed: ['visualizer:liquid'],
    ratings: { liquid: { avg: 3.7, count: 9 } },
  }));
  const liquid = out.find((i) => i.key === 'visualizer:liquid');
  assert.ok(liquid);
  assert.equal(liquid.removed, true);
  assert.deepEqual(liquid.rating, { avg: 3.7, count: 9 });
});

// applyOptimisticVote — the pure recomputation behind StarRating's
// optimistic update while marketplace_rate's POST is in flight. Renamed
// from applyOptimisticRating and given a `previousStars` parameter per D3
// review's Important 2: the old version treated every vote as additive, so
// two changes of mind in one session overcounted by two phantom votes, not
// the "overcounts by one" the old doc comment claimed.

test('applyOptimisticVote: a first vote (no previousStars) on an unrated bundle becomes the whole average', () => {
  assert.deepEqual(applyOptimisticVote(null, 4, null), { avg: 4, count: 1 });
});

test('applyOptimisticVote: a zero-count rating object is treated the same as null', () => {
  assert.deepEqual(applyOptimisticVote({ avg: 0, count: 0 }, 5, null), { avg: 5, count: 1 });
});

test('applyOptimisticVote: a first-this-session vote (previousStars null) is additive — shifts the average and increments the count', () => {
  // 3 votes averaging 4.0 (total 12), a new vote of 2: (12+2)/4 = 3.5.
  assert.deepEqual(applyOptimisticVote({ avg: 4, count: 3 }, 2, null), { avg: 3.5, count: 4 });
});

test('applyOptimisticVote: a re-vote (previousStars set) replaces rather than adds — count unchanged', () => {
  // 4 votes averaging 3.5 (total 14) where THIS user's own prior optimistic
  // vote was a 2 — changing it to a 5 should replace that 2 with a 5:
  // (14 - 2 + 5) / 4 = 4.25, count stays 4.
  const out = applyOptimisticVote({ avg: 3.5, count: 4 }, 5, 2);
  assert.equal(out.count, 4, 'count must not increment on a re-vote');
  assert.ok(Math.abs(out.avg - 4.25) < 1e-9, `expected avg ~4.25, got ${out.avg}`);
});

test('applyOptimisticVote: three sequential votes for the same bundle never compound past a single +1', () => {
  // The exact regression D3 caught: repeatedly changing your mind must not
  // accumulate phantom votes. Start from 3 OTHER users averaging 4.0 (total
  // 12, count 3) with nobody from this session voted yet.
  let rating = { avg: 4, count: 3 };
  let previousStars: number | null = null;

  // First vote: 5. Additive — count becomes 4, total 17, avg 4.25.
  rating = applyOptimisticVote(rating, 5, previousStars);
  assert.deepEqual(rating, { avg: 4.25, count: 4 });
  previousStars = 5;

  // Changed my mind: 2. Replaces the 5, NOT additive — count stays 4,
  // total (17-5+2)=14, avg 3.5.
  rating = applyOptimisticVote(rating, 2, previousStars);
  assert.equal(rating.count, 4, 'count must still be 4 after the first re-vote');
  assert.ok(Math.abs(rating.avg - 3.5) < 1e-9, `expected avg 3.5, got ${rating.avg}`);
  previousStars = 2;

  // Changed my mind again: 4. Replaces the 2 — count still 4,
  // total (14-2+4)=16, avg 4.0. If this were still additive (the D3 bug),
  // count would now be 6 and avg would be wrong.
  rating = applyOptimisticVote(rating, 4, previousStars);
  assert.equal(rating.count, 4, 'count must never exceed the ONE real vote this session cast');
  assert.ok(Math.abs(rating.avg - 4.0) < 1e-9, `expected avg 4.0, got ${rating.avg}`);
});

// preset kind — MilkDrop presets admitted into the catalog as their own
// CatalogKind (Task 4). Same three-pass shape as tile/visualizer: a
// compile-time table entry doesn't exist for presets (there is no built-in
// preset table), so pass 1 is skipped; pass 2 is installed preset folders;
// pass 3 is the signed index, which now includes 'preset'-kind bundles
// instead of skipping them.

test('mergeCatalog: an index preset entry not installed is available, not installed', () => {
  const out = mergeCatalog(base({
    index: [presetIdx({ hasPreview: true })],
  }));
  const p = out.find((i) => i.key === 'preset:tron-grid');
  assert.ok(p);
  assert.equal(p.kind, 'preset');
  assert.equal(p.installed, false);
  assert.equal(p.availableVersion, '1.0.0');
  assert.equal(p.hasPreview, true);
  assert.equal(p.category, 'milkdrop');
});

test('mergeCatalog: an installed preset with a newer index version flags an update and shows the author', () => {
  const out = mergeCatalog(base({
    installedPresets: [presetFolder({ version: '1.0.0' })],
    index: [presetIdx({ version: '1.1.0' })],
  }));
  const p = out.find((i) => i.key === 'preset:tron-grid');
  assert.ok(p);
  assert.equal(p.installed, true);
  assert.equal(p.installedVersion, '1.0.0');
  assert.equal(p.availableVersion, '1.1.0');
  assert.equal(p.updateAvailable, true);
  assert.equal(p.description, 'by oli***');
});

test('mergeCatalog: an installed preset absent from the index still appears (offline case)', () => {
  const out = mergeCatalog(base({ installedPresets: [presetFolder()] }));
  const p = out.find((i) => i.key === 'preset:tron-grid');
  assert.ok(p, 'installed preset survives with no index entry');
  assert.equal(p.kind, 'preset');
  assert.equal(p.installed, true);
  assert.equal(p.category, 'milkdrop');
});

test('mergeCatalog: a removed preset key still listed in the index is available again — same as any other kind', () => {
  // Mirrors "a removed key still listed in the index is available again" for
  // visualizers: pass 2 (installed preset folders) skips removed keys just
  // like installedFolder does for tiles/viz — real removal already
  // uninstalls the folder — so what keeps a removed preset browsable is
  // pass 3 (the index), not pass 2.
  const out = mergeCatalog(base({
    removed: ['preset:tron-grid'],
    index: [presetIdx()],
  }));
  const p = out.find((i) => i.key === 'preset:tron-grid');
  assert.ok(p, 'stays in the output so the Removed rail row has a name to show, and can be reinstalled');
  assert.equal(p.removed, true);
  assert.equal(p.installed, false);
  assert.equal(p.installedVersion, null);
});

test('mergeCatalog: an installed preset tombstoned before its folder is removed is dropped from pass 2 (matches installedFolder)', () => {
  // Documents pass 2's `if (removed.has(key)) continue;` — the same skip
  // installedFolder applies to tile/viz installed folders. With no index
  // entry to fall back on, the item is simply absent, same as an
  // installed-only tile/viz folder would be in this situation.
  const out = mergeCatalog(base({
    installedPresets: [presetFolder()],
    removed: ['preset:tron-grid'],
  }));
  assert.equal(out.some((i) => i.key === 'preset:tron-grid'), false);
});

test('catalogKey: composes kind and id', () => {
  assert.equal(catalogKey('tile', 'quote'), 'tile:quote');
  assert.equal(catalogKey('visualizer', 'aurora'), 'visualizer:aurora');
});

// planRemoval — the previously-untested logic behind handleRemove
// (ContentLibrary.tsx). `weatherRadar` is a real, camelCase, non-first-party
// TILE_META key with no installed folder: the exact shape that broke when a
// prior pass gated `uninstall` on `source === 'bundle'` instead of
// `installedVersion != null` (see the bug write-up in catalog.ts).

test('planRemoval: a not-yet-migrated built-in (table entry, no folder) skips uninstall', () => {
  const out = mergeCatalog(base());
  const item = out.find((i) => i.key === 'tile:weatherRadar');
  assert.ok(item, 'weatherRadar is a real TILE_META key');
  assert.equal(item.source, 'bundle', 'not first-party, so mergeCatalog labels it a bundle target');
  assert.equal(item.installedVersion, null, 'no folder backs it');
  const plan = planRemoval(item);
  assert.equal(plan.uninstall, false, 'no folder to uninstall — invoking would send a camelCase id');
  assert.equal(plan.tombstoneKey, 'tile:weatherRadar');
  assert.equal(plan.instanceType, 'weatherRadar', 'a built-in tile type has no bundle: prefix');
});

test('planRemoval: an installed bundle uninstalls and strips its bundle: instance type', () => {
  // A fresh id with no TILE_META entry — `quote` collides with a built-in
  // table key too, which exercises the *other* (deliberate) branch of
  // isBuiltinTileId; see the "a migrated tile collapses" test above and the
  // ambiguity note on isBuiltinTileId in catalog.ts.
  const out = mergeCatalog(base({ installedTiles: [tileFolder({ id: 'cool-widget', name: 'Cool widget' })] }));
  const item = out.find((i) => i.key === 'tile:cool-widget');
  assert.ok(item);
  assert.equal(item.installedVersion, '1.0.1');
  const plan = planRemoval(item);
  assert.equal(plan.uninstall, true, 'a real folder backs it');
  assert.equal(plan.tombstoneKey, 'tile:cool-widget');
  assert.equal(plan.instanceType, 'bundle:cool-widget', 'no compile-time table entry — bundle-prefixed');
});

test('planRemoval: a first-party item skips uninstall and has no dashboard instance type when a visualizer', () => {
  const out = mergeCatalog(base());
  const item = out.find((i) => i.key === 'visualizer:milkdrop');
  assert.ok(item);
  assert.equal(item.source, 'first-party');
  assert.equal(item.installedVersion, null, 'ships in the binary — no folder to uninstall');
  const plan = planRemoval(item);
  assert.equal(plan.uninstall, false);
  assert.equal(plan.tombstoneKey, 'visualizer:milkdrop');
  assert.equal(plan.instanceType, null, 'visualizers have no dashboard instance to strip');
});

test('planRemoval: an installed preset uninstalls and has no dashboard instance type', () => {
  const out = mergeCatalog(base({ installedPresets: [presetFolder()] }));
  const item = out.find((i) => i.key === 'preset:tron-grid');
  assert.ok(item);
  const plan = planRemoval(item);
  assert.equal(plan.uninstall, true, 'a real preset folder backs it');
  assert.equal(plan.tombstoneKey, 'preset:tron-grid');
  assert.equal(plan.instanceType, null, 'presets have no dashboard instance to strip');
});

test('planRemoval: a removed-but-index-listed item is idempotent — still no uninstall, same tombstone key', () => {
  const out = mergeCatalog(base({ removed: ['visualizer:aurora'], index: [idx()] }));
  const item = out.find((i) => i.key === 'visualizer:aurora');
  assert.ok(item, 'stays browsable so it can be reinstalled');
  assert.equal(item.installed, false);
  assert.equal(item.installedVersion, null);
  const plan = planRemoval(item);
  assert.equal(plan.uninstall, false, 'already removed — nothing on disk to uninstall');
  assert.equal(plan.tombstoneKey, 'visualizer:aurora', 're-removing is a harmless no-op, not a new key');
  assert.equal(plan.instanceType, null, 'a visualizer, so no tile instance type either way');
});

// restoreDefaults — the previously-untested logic behind
// handleRestoreDefaults (ContentLibrary.tsx). The ordering here is
// load-bearing: seed_sync (what `seedSync` wraps) reads the removed list it
// is given, so clearing it AFTER syncing would leave every tombstone in
// place and the sync would skip everything — restore-defaults would
// silently do nothing. See the doc comment on restoreDefaults in catalog.ts.

test('restoreDefaults: clears removed before syncing, not after', async () => {
  const calls: string[] = [];
  await restoreDefaults({
    clearRemoved: () => { calls.push('clear'); },
    seedSync: async (removed) => { calls.push('sync'); return []; },
  });
  assert.deepEqual(calls, ['clear', 'sync'], 'clear must be observed to happen before sync starts');
});

test('restoreDefaults: seedSync always receives [], never a stale removal list', async () => {
  let received: string[] | null = null;
  await restoreDefaults({
    clearRemoved: () => {},
    seedSync: async (removed) => { received = removed; return []; },
  });
  assert.deepEqual(received, [], 'seedSync must not see the pre-clear tombstones');
});

test('restoreDefaults: propagates the installed keys seedSync returns', async () => {
  const installed = ['tile:quote', 'visualizer:aurora'];
  const result = await restoreDefaults({
    clearRemoved: () => {},
    seedSync: async () => installed,
  });
  assert.deepEqual(result, installed);
});

test('restoreDefaults: a throwing seedSync still leaves clearRemoved having run, and rejects', async () => {
  let cleared = false;
  await assert.rejects(
    () => restoreDefaults({
      clearRemoved: () => { cleared = true; },
      seedSync: async () => { throw new Error('marketplace unreachable'); },
    }),
    /marketplace unreachable/,
    'the error must propagate so the caller can surface it',
  );
  assert.equal(cleared, true, 'clearRemoved already ran and is not rolled back on a sync failure');
});

// secretSetupCandidates — the pure half of Important 4's fix (ContentLibrary's
// needsSetup effect). Scoped to secrets only; see the doc comment in catalog.ts.

const indexMap = (bundles: IndexBundle[]): Map<string, IndexBundle> => {
  const m = new Map<string, IndexBundle>();
  for (const b of bundles) m.set(catalogKey(b.kind === 'preset' ? 'tile' : b.kind, b.id), b);
  return m;
};

test('secretSetupCandidates: an installed bundle declaring a secret permission is a candidate', () => {
  const out = secretSetupCandidates(
    [tileFolder({ id: 'github-prs' })], [],
    indexMap([idx({ id: 'github-prs', kind: 'tile', permissions: ['secret:github_pat'] })]),
  );
  assert.equal(out.length, 1);
  assert.equal(out[0]?.key, 'tile:github-prs');
  assert.equal(out[0]?.bundleId, 'github-prs');
  assert.deepEqual(out[0]?.secretKeys, ['github_pat']);
});

test('secretSetupCandidates: net/tauri permissions are not secrets and produce no candidate', () => {
  const out = secretSetupCandidates(
    [tileFolder({ id: 'weather-radar' })], [],
    indexMap([idx({ id: 'weather-radar', kind: 'tile', permissions: ['net:api.example.com'] })]),
  );
  assert.deepEqual(out, []);
});

test('secretSetupCandidates: not in the index (offline or unlisted) is not a candidate', () => {
  const out = secretSetupCandidates([tileFolder({ id: 'github-prs' })], [], indexMap([]));
  assert.deepEqual(out, [], 'no permissions data available without an index entry');
});

test('secretSetupCandidates: a local draft folder is never a candidate', () => {
  const out = secretSetupCandidates(
    [], [vizFolder({ id: 'draft', source: 'local' })],
    indexMap([idx({ id: 'draft', kind: 'visualizer', permissions: ['secret:api_key'] })]),
  );
  assert.deepEqual(out, []);
});

test('secretSetupCandidates: a visualizer folder resolves against the visualizer index entry', () => {
  const out = secretSetupCandidates(
    [], [vizFolder({ id: 'aurora' })],
    indexMap([idx({ id: 'aurora', kind: 'visualizer', permissions: ['secret:weather_key'] })]),
  );
  assert.equal(out.length, 1);
  assert.equal(out[0]?.key, 'visualizer:aurora');
  assert.deepEqual(out[0]?.secretKeys, ['weather_key']);
});
