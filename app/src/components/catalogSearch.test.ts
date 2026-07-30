import test from 'node:test';
import assert from 'node:assert/strict';
import { searchItems } from './catalogSearch';
import type { CatalogItem } from '../state/catalog';

const item = (name: string, description = ''): CatalogItem => ({
  key: `tile:${name}`, kind: 'tile', id: name, name, description, category: 'weather',
  source: 'bundle', installed: false, installedVersion: null, availableVersion: '1.0.0',
  updateAvailable: false, permissions: [], needsSetup: false, downloads: 0, brokenReason: null,
  removed: false,
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
