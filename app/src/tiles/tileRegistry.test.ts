import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeTileCatalog, type InstalledTileFolder } from './tileRegistry';
import { TILE_META } from '../state/tileMeta';

const folder = (o: Partial<InstalledTileFolder> = {}): InstalledTileFolder => ({
  id: 'my-tile', name: 'My Tile', author: 'official', version: '1.0.0',
  api: 1, manifest_error: null, source: 'marketplace', ...o,
});

test('mergeTileCatalog: no installed tiles leaves builtins untouched', () => {
  const out = mergeTileCatalog(TILE_META, []);
  assert.equal(out.length, Object.keys(TILE_META).length);
  assert.equal(out.every((e) => e.source === 'builtin'), true);
});

test('mergeTileCatalog: an installed tile becomes a catalog entry', () => {
  const out = mergeTileCatalog(TILE_META, [folder()]);
  const e = out.find((x) => x.type === 'bundle:my-tile');
  assert.ok(e);
  assert.equal(e.source, 'bundle');
  assert.equal(e.meta.label, 'My Tile');
  assert.equal(e.meta.multiInstance, false);
});

test('mergeTileCatalog: a local or invalid folder is skipped', () => {
  assert.equal(mergeTileCatalog(TILE_META, [folder({ source: 'local' })]).some((e) => e.source === 'bundle'), false);
  assert.equal(mergeTileCatalog(TILE_META, [folder({ manifest_error: 'bad' })]).some((e) => e.source === 'bundle'), false);
  assert.equal(mergeTileCatalog(TILE_META, [folder({ api: 2 })]).some((e) => e.source === 'bundle'), false);
});

test('mergeTileCatalog: a bundle cannot shadow a builtin tile id', () => {
  const out = mergeTileCatalog(TILE_META, [folder({ id: 'clock', name: 'Impostor' })]);
  assert.equal(out.filter((e) => e.meta.label === 'Impostor').length, 0);
});

test('mergeTileCatalog: installed tiles carry the integrations category', () => {
  const e = mergeTileCatalog(TILE_META, [folder()]).find((x) => x.source === 'bundle');
  assert.equal(e?.meta.category, 'integrations');
});
