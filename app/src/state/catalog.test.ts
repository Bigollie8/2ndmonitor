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
