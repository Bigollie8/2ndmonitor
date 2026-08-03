import test from 'node:test';
import assert from 'node:assert/strict';
import { authorIndexOf, authorLabelOf } from './authorIndex';
import type { CatalogItem } from './catalog';

const item = (o: Partial<CatalogItem> = {}): CatalogItem => ({
  key: 'tile:x', kind: 'tile', id: 'x', name: 'X', description: '', category: 'weather',
  source: 'bundle', installed: false, installedVersion: null, availableVersion: '1.0.0',
  updateAvailable: false, permissions: [], needsSetup: false, downloads: 0, brokenReason: null,
  removed: false, hasPreview: false, rating: null,
  summary: null, tags: [], icon: null, changelog: null, minAppVersion: null,
  featured: false, approvedAt: null, mediaCount: 0, authorDisplay: null, ...o,
});

test('bundles group under their author', () => {
  const idx = authorIndexOf([
    item({ key: 'a', id: 'a', authorDisplay: 'oli***' }),
    item({ key: 'b', id: 'b', authorDisplay: 'oli***' }),
    item({ key: 'c', id: 'c', authorDisplay: 'ann***' }),
  ]);
  assert.equal(idx.get('oli***')!.items.length, 2);
  assert.equal(idx.get('ann***')!.items.length, 1);
});

test('downloads total across an author\'s bundles, treating null as zero', () => {
  const idx = authorIndexOf([
    item({ key: 'a', id: 'a', authorDisplay: 'oli***', downloads: 100 }),
    item({ key: 'b', id: 'b', authorDisplay: 'oli***', downloads: null }),
    item({ key: 'c', id: 'c', authorDisplay: 'oli***', downloads: 5 }),
  ]);
  assert.equal(idx.get('oli***')!.totalDownloads, 105);
});

test('a first-party built-in has no author page', () => {
  assert.equal(authorLabelOf(item({ source: 'first-party', authorDisplay: 'oli***' })), null);
});

test('an item with no author is excluded rather than grouped under an empty key', () => {
  const idx = authorIndexOf([item({ key: 'a', id: 'a', authorDisplay: null })]);
  assert.equal(idx.size, 0);
});

test('removed items do not appear on an author page', () => {
  const idx = authorIndexOf([
    item({ key: 'a', id: 'a', authorDisplay: 'oli***', removed: true }),
    item({ key: 'b', id: 'b', authorDisplay: 'oli***' }),
  ]);
  assert.equal(idx.get('oli***')!.items.length, 1);
});

test('an author whose every bundle is removed has no page at all', () => {
  const idx = authorIndexOf([item({ key: 'a', id: 'a', authorDisplay: 'oli***', removed: true })]);
  assert.equal(idx.size, 0);
});
