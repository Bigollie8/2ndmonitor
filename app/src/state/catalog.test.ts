import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeCatalog, catalogKey, planRemoval, restoreDefaults, type MergeCatalogArgs } from './catalog';
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

test('mergeCatalog: a table-only built-in that also has an index entry stays installed, no update', () => {
  // `bars` is a built-in with no installed folder — it ships and works today
  // even if the marketplace also lists it. It must not flip to "Install".
  const out = mergeCatalog(base({ index: [idx({ id: 'bars', kind: 'visualizer', version: '1.1.0' })] }));
  const bars = out.find((i) => i.key === 'visualizer:bars');
  assert.ok(bars);
  assert.equal(bars.installed, true);
  assert.equal(bars.updateAvailable, false, 'no installedVersion to compare against, so no update badge');
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
