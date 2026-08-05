import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveFeed, feedShelf, FEED_SHELF_MAX } from './socialFeed';
import type { CatalogItem } from './catalog';

const item = (o: Partial<CatalogItem> = {}): CatalogItem => ({
  key: 'tile:x', kind: 'tile', id: 'x', name: 'X', description: '', category: 'weather',
  source: 'bundle', installed: false, installedVersion: null, availableVersion: '1.0.0',
  updateAvailable: false, permissions: [], needsSetup: false, downloads: 0, brokenReason: null,
  removed: false, hasPreview: false, rating: null,
  summary: null, tags: [], icon: null, changelog: null, minAppVersion: null,
  featured: false, approvedAt: null, mediaCount: 0, authorDisplay: null, authorHandle: null, ...o,
});

test('the server order is preserved — it is newest-first and that is the point', () => {
  const items = [item({ id: 'a' }), item({ id: 'b' }), item({ id: 'c' })];
  assert.deepEqual(resolveFeed(['c', 'a', 'b'], items).map((i) => i.id), ['c', 'a', 'b']);
});

test('duplicate ids resolve once', () => {
  const items = [item({ id: 'a' })];
  assert.equal(resolveFeed(['a', 'a', 'a'], items).length, 1);
});

test('an id the catalog has never heard of is dropped rather than crashing the shelf', () => {
  const items = [item({ id: 'a' })];
  assert.deepEqual(resolveFeed(['ghost', 'a'], items).map((i) => i.id), ['a']);
});

// A tombstoned bundle must not sneak back in through the feed.
test('removed items are excluded', () => {
  const items = [item({ id: 'a', removed: true }), item({ id: 'b' })];
  assert.deepEqual(resolveFeed(['a', 'b'], items).map((i) => i.id), ['b']);
});

test('an empty feed yields no shelf, not an empty one', () => {
  // An empty personal shelf would read as "the people you follow made
  // nothing" — a worse message than no shelf at all.
  assert.equal(feedShelf([], [item({ id: 'a' })]), null);
  assert.equal(feedShelf(['ghost'], [item({ id: 'a' })]), null);
});

test('one item is enough for a shelf — same exemption the Updates shelf has', () => {
  const shelf = feedShelf(['a'], [item({ id: 'a' })]);
  assert.ok(shelf);
  assert.equal(shelf?.items.length, 1);
  assert.equal(shelf?.id, 'feed');
});

test('the shelf caps like every other shelf', () => {
  const ids = Array.from({ length: 30 }, (_, i) => `b${i}`);
  const items = ids.map((id) => item({ id, key: `tile:${id}` }));
  assert.equal(feedShelf(ids, items)?.items.length, FEED_SHELF_MAX);
});
