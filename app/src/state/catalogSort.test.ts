import test from 'node:test';
import assert from 'node:assert/strict';
import { sortItems, SORT_LABELS, type SortMode } from './catalogSort';
import type { CatalogItem } from './catalog';

const item = (o: Partial<CatalogItem> = {}): CatalogItem => ({
  key: 'tile:x', kind: 'tile', id: 'x', name: 'X', description: '', category: 'weather',
  source: 'bundle', installed: false, installedVersion: null, availableVersion: '1.0.0',
  updateAvailable: false, permissions: [], needsSetup: false, downloads: 0, brokenReason: null,
  removed: false, hasPreview: false, rating: null,
  summary: null, tags: [], icon: null, changelog: null, minAppVersion: null,
  featured: false, approvedAt: null, mediaCount: 0, authorDisplay: null, ...o,
});

const names = (items: CatalogItem[]) => items.map((i) => i.name);

test('sortItems: name is A-Z and is what the catalog used to do unconditionally', () => {
  const out = sortItems([item({ name: 'Zulu' }), item({ name: 'alpha' }), item({ name: 'Mike' })], 'name');
  assert.deepEqual(names(out), ['alpha', 'Mike', 'Zulu']);
});

test('sortItems: installs orders by download count, highest first', () => {
  const out = sortItems([
    item({ name: 'few', downloads: 3 }),
    item({ name: 'many', downloads: 900 }),
    item({ name: 'none', downloads: null }),
  ], 'installs');
  assert.deepEqual(names(out), ['many', 'few', 'none']);
});

test('sortItems: rating orders by average, and an unrated item sorts last', () => {
  const out = sortItems([
    item({ name: 'ok', rating: { avg: 3.2, count: 10 } }),
    item({ name: 'great', rating: { avg: 4.8, count: 4 } }),
    item({ name: 'unrated', rating: null }),
  ], 'rating');
  assert.deepEqual(names(out), ['great', 'ok', 'unrated']);
});

test('sortItems: newest and updated read the injected date map', () => {
  const dates = new Map([
    ['tile:a', { publishedAt: 100, updatedAt: 100 }],
    ['tile:b', { publishedAt: 50, updatedAt: 900 }],
  ]);
  const items = [
    item({ key: 'tile:a', id: 'a', name: 'A' }),
    item({ key: 'tile:b', id: 'b', name: 'B' }),
  ];
  assert.deepEqual(names(sortItems(items, 'newest', dates)), ['A', 'B'], 'A was published later');
  assert.deepEqual(names(sortItems(items, 'updated', dates)), ['B', 'A'], 'B was updated later');
});

test('sortItems: an item with no date sorts last rather than first', () => {
  const dates = new Map([['tile:a', { publishedAt: 100, updatedAt: 100 }]]);
  const out = sortItems([
    item({ key: 'tile:z', id: 'z', name: 'Z' }),
    item({ key: 'tile:a', id: 'a', name: 'A' }),
  ], 'newest', dates);
  assert.deepEqual(names(out), ['A', 'Z'], 'unknown date must not masquerade as brand new');
});

test('sortItems: relevance preserves the incoming order', () => {
  // Search has already ordered by score; relevance is identity so the two
  // never fight over the same decision.
  const items = [item({ name: 'third' }), item({ name: 'first' }), item({ name: 'second' })];
  assert.deepEqual(names(sortItems(items, 'relevance')), ['third', 'first', 'second']);
});

test('sortItems: ties break on name so ordering is stable and never arbitrary', () => {
  const out = sortItems([
    item({ name: 'beta', downloads: 5 }),
    item({ name: 'alpha', downloads: 5 }),
  ], 'installs');
  assert.deepEqual(names(out), ['alpha', 'beta']);
});

test('sortItems: never mutates its input', () => {
  const items = [item({ name: 'b' }), item({ name: 'a' })];
  const before = names(items);
  sortItems(items, 'name');
  assert.deepEqual(names(items), before);
});

test('every SortMode has a label', () => {
  const modes: SortMode[] = ['relevance', 'installs', 'rating', 'newest', 'updated', 'name'];
  for (const m of modes) assert.ok(SORT_LABELS[m], `missing label for ${m}`);
});
