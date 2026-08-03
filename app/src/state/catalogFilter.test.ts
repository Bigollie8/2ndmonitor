import test from 'node:test';
import assert from 'node:assert/strict';
import { filterItems, EMPTY_FACETS } from './catalogFilter';
import type { CatalogItem } from './catalog';

const item = (o: Partial<CatalogItem> = {}): CatalogItem => ({
  key: 'tile:x', kind: 'tile', id: 'x', name: 'X', description: '', category: 'weather',
  source: 'bundle', installed: false, installedVersion: null, availableVersion: '1.0.0',
  updateAvailable: false, permissions: [], needsSetup: false, downloads: 0, brokenReason: null,
  removed: false, hasPreview: false, rating: null,
  summary: null, tags: [], icon: null, changelog: null, minAppVersion: null,
  featured: false, approvedAt: null, mediaCount: 0, authorDisplay: null, ...o,
});

const APP = '0.8.0';

test('filterItems: no facets returns everything visible, excluding removed', () => {
  const out = filterItems([
    item({ key: 'a', id: 'a' }),
    item({ key: 'b', id: 'b', removed: true }),
  ], EMPTY_FACETS, APP);
  assert.deepEqual(out.map((i) => i.id), ['a']);
});

test('filterItems: removed:true selects ONLY removed items', () => {
  const out = filterItems([
    item({ key: 'a', id: 'a' }),
    item({ key: 'b', id: 'b', removed: true }),
  ], { ...EMPTY_FACETS, removed: true }, APP);
  assert.deepEqual(out.map((i) => i.id), ['b']);
});

// The whole point of this module: today "installed" and "weather" are both
// rail ROWS backed by predicates, so they cannot be combined.
test('filterItems: facets combine', () => {
  const out = filterItems([
    item({ key: 'a', id: 'a', installed: true, category: 'weather' }),
    item({ key: 'b', id: 'b', installed: true, category: 'media' }),
    item({ key: 'c', id: 'c', installed: false, category: 'weather' }),
  ], { ...EMPTY_FACETS, installed: true, category: 'weather' }, APP);
  assert.deepEqual(out.map((i) => i.id), ['a']);
});

test('filterItems: tags are AND-ed, not OR-ed', () => {
  const out = filterItems([
    item({ key: 'a', id: 'a', tags: ['rain', 'map'] }),
    item({ key: 'b', id: 'b', tags: ['rain'] }),
  ], { ...EMPTY_FACETS, tags: ['rain', 'map'] }, APP);
  assert.deepEqual(out.map((i) => i.id), ['a']);
});

test('filterItems: kind, updates, needsSetup, hasPreview each narrow', () => {
  const items = [
    item({ key: 'a', id: 'a', kind: 'tile', updateAvailable: true }),
    item({ key: 'b', id: 'b', kind: 'visualizer', installed: true, needsSetup: true }),
    item({ key: 'c', id: 'c', kind: 'preset', hasPreview: true }),
  ];
  assert.deepEqual(
    filterItems(items, { ...EMPTY_FACETS, kind: 'visualizer' }, APP).map((i) => i.id), ['b']);
  assert.deepEqual(
    filterItems(items, { ...EMPTY_FACETS, updates: true }, APP).map((i) => i.id), ['a']);
  assert.deepEqual(
    filterItems(items, { ...EMPTY_FACETS, needsSetup: true }, APP).map((i) => i.id), ['b']);
  assert.deepEqual(
    filterItems(items, { ...EMPTY_FACETS, hasPreview: true }, APP).map((i) => i.id), ['c']);
});

test('filterItems: noPermissions selects the offline-safe bundles', () => {
  const out = filterItems([
    item({ key: 'a', id: 'a', permissions: [] }),
    item({ key: 'b', id: 'b', permissions: ['net:example.com'] }),
  ], { ...EMPTY_FACETS, noPermissions: true }, APP);
  assert.deepEqual(out.map((i) => i.id), ['a']);
});

test('filterItems: incompatible selects bundles the running app is too old for', () => {
  const out = filterItems([
    item({ key: 'a', id: 'a', minAppVersion: '0.9.0' }),
    item({ key: 'b', id: 'b', minAppVersion: '0.8.0' }),
    item({ key: 'c', id: 'c', minAppVersion: null }),
  ], { ...EMPTY_FACETS, incompatible: true }, APP);
  assert.deepEqual(out.map((i) => i.id), ['a']);
});

test('filterItems: never mutates its input', () => {
  const items = [item({ key: 'a', id: 'a' })];
  const copy = [...items];
  filterItems(items, EMPTY_FACETS, APP);
  assert.deepEqual(items, copy);
});
