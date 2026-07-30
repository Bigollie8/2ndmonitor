import test from 'node:test';
import assert from 'node:assert/strict';
import { previewSourceFor } from './previewSource';
import type { CatalogItem } from '../state/catalog';

const item = (o: Partial<CatalogItem> = {}): CatalogItem => ({
  key: 'visualizer:aurora', kind: 'visualizer', id: 'aurora', name: 'Aurora',
  description: '', category: 'ambient', source: 'bundle', installed: false,
  installedVersion: null, availableVersion: '1.0.0', updateAvailable: false,
  permissions: [], needsSetup: false, downloads: 0, brokenReason: null,
  removed: false, hasPreview: false, ...o,
});

test('previewSourceFor: an installed visualizer previews live', () => {
  const s = previewSourceFor(item({ installed: true, installedVersion: '1.0.0' }), null);
  assert.deepEqual(s, { kind: 'live', bundleId: 'aurora' });
});

test('previewSourceFor: a first-party item uses its glyph, never a live preview', () => {
  const s = previewSourceFor(item({ source: 'first-party', installed: true, installedVersion: '1.0.0' }), '◢');
  assert.deepEqual(s, { kind: 'glyph', glyph: '◢' });
});

test('previewSourceFor: an uninstalled item with a published preview uses the image', () => {
  assert.deepEqual(previewSourceFor(item({ hasPreview: true }), null), { kind: 'image' });
});

test('previewSourceFor: an installed tile prefers its image over its glyph', () => {
  const s = previewSourceFor(item({ kind: 'tile', id: 'tile-quote', key: 'tile:tile-quote', installed: true, installedVersion: '1.0.1', hasPreview: true }), '❝');
  assert.deepEqual(s, { kind: 'image' });
});

test('previewSourceFor: a tile never previews live even when installed', () => {
  const s = previewSourceFor(item({ kind: 'tile', id: 'tile-quote', key: 'tile:tile-quote', installed: true, installedVersion: '1.0.1' }), null);
  assert.deepEqual(s, { kind: 'placeholder' });
});

test('previewSourceFor: a broken install falls back rather than running', () => {
  const s = previewSourceFor(item({ installed: true, installedVersion: '1.0.0', brokenReason: 'bad api' }), null);
  assert.deepEqual(s, { kind: 'placeholder' });
});

test('previewSourceFor: a removed item does not run live code', () => {
  const s = previewSourceFor(item({ removed: true, installed: false }), null);
  assert.notEqual(s.kind, 'live');
});

test('previewSourceFor: nothing available yields the placeholder', () => {
  assert.deepEqual(previewSourceFor(item(), null), { kind: 'placeholder' });
});
