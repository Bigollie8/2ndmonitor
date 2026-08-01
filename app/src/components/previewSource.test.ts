import test from 'node:test';
import assert from 'node:assert/strict';
import { previewSourceFor, canLivePreview } from './previewSource';
import type { CatalogItem } from '../state/catalog';

const item = (o: Partial<CatalogItem> = {}): CatalogItem => ({
  key: 'visualizer:aurora', kind: 'visualizer', id: 'aurora', name: 'Aurora',
  description: '', category: 'ambient', source: 'bundle', installed: false,
  installedVersion: null, availableVersion: '1.0.0', updateAvailable: false,
  permissions: [], needsSetup: false, downloads: 0, brokenReason: null,
  removed: false, hasPreview: false, rating: null, ...o,
});

test('previewSourceFor: an installed visualizer with a published preview shows the image (finding 31)', () => {
  const s = previewSourceFor(item({ installed: true, installedVersion: '1.0.0', hasPreview: true }), null);
  assert.deepEqual(s, { kind: 'image' });
});

test('previewSourceFor: an installed visualizer without an image falls back to placeholder, never live', () => {
  const s = previewSourceFor(item({ installed: true, installedVersion: '1.0.0' }), null);
  assert.deepEqual(s, { kind: 'placeholder' });
});

test('previewSourceFor: a first-party item uses its glyph, never an image', () => {
  const s = previewSourceFor(item({ source: 'first-party', installed: true, installedVersion: '1.0.0', hasPreview: true }), '◢');
  assert.deepEqual(s, { kind: 'glyph', glyph: '◢' });
});

test('previewSourceFor: an uninstalled item with a published preview uses the image', () => {
  assert.deepEqual(previewSourceFor(item({ hasPreview: true }), null), { kind: 'image' });
});

test('previewSourceFor: an installed tile prefers its image over its glyph', () => {
  const s = previewSourceFor(item({ kind: 'tile', id: 'tile-quote', key: 'tile:tile-quote', installed: true, installedVersion: '1.0.1', hasPreview: true }), '❝');
  assert.deepEqual(s, { kind: 'image' });
});

test('previewSourceFor: nothing available yields the placeholder', () => {
  assert.deepEqual(previewSourceFor(item(), null), { kind: 'placeholder' });
});

test('canLivePreview: true only for an installed, healthy visualizer bundle', () => {
  assert.equal(canLivePreview(item({ installed: true, installedVersion: '1.0.0' })), true);
});

test('canLivePreview: false for a tile even when installed', () => {
  assert.equal(canLivePreview(item({ kind: 'tile', id: 'tile-quote', key: 'tile:tile-quote', installed: true, installedVersion: '1.0.1' })), false);
});

test('canLivePreview: false when uninstalled — live runs bundle code, which must exist and have validated', () => {
  assert.equal(canLivePreview(item()), false);
});

test('canLivePreview: false for a broken install', () => {
  assert.equal(canLivePreview(item({ installed: true, installedVersion: '1.0.0', brokenReason: 'bad api' })), false);
});

test('canLivePreview: false for a removed item', () => {
  assert.equal(canLivePreview(item({ removed: true, installed: true, installedVersion: '1.0.0' })), false);
});

test('canLivePreview: false for a first-party item — built-ins are not bundles', () => {
  assert.equal(canLivePreview(item({ source: 'first-party', installed: true, installedVersion: '1.0.0' })), false);
});
