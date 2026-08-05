import test from 'node:test';
import assert from 'node:assert/strict';
import { buildShelves, parseCollections, SHELF_MIN, type Collection } from './catalogShelves';
import type { CatalogItem } from './catalog';
import type { DateMap } from './catalogSort';

const item = (o: Partial<CatalogItem> = {}): CatalogItem => ({
  key: 'tile:x', kind: 'tile', id: 'x', name: 'X', description: '', category: 'weather',
  source: 'bundle', installed: false, installedVersion: null, availableVersion: '1.0.0',
  updateAvailable: false, permissions: [], needsSetup: false, downloads: 0, brokenReason: null,
  removed: false, hasPreview: false, rating: null,
  summary: null, tags: [], icon: null, changelog: null, minAppVersion: null,
  featured: false, approvedAt: null, mediaCount: 0, authorDisplay: null, ...o,
});

const many = (n: number, o: (i: number) => Partial<CatalogItem>) =>
  Array.from({ length: n }, (_, i) => item({ key: `tile:${i}`, id: String(i), name: `N${i}`, ...o(i) }));

const NOW = 1_000_000;
const build = (items: CatalogItem[], dates: DateMap = new Map(), collections: Collection[] = []) =>
  buildShelves({ items, collections, dates, nowSec: NOW, appVersion: '0.8.0' });

test('buildShelves: updates shelf leads and ignores the minimum-count rule', () => {
  // One pending update is worth surfacing; a one-item Featured shelf is not.
  const shelves = build([item({ installed: true, updateAvailable: true })]);
  assert.equal(shelves[0].id, 'updates');
  assert.equal(shelves[0].items.length, 1);
});

test('buildShelves: a shelf below the minimum is suppressed', () => {
  const shelves = build(many(2, () => ({ featured: true })));
  assert.equal(shelves.some((s) => s.id === 'featured'), false,
    `fewer than ${SHELF_MIN} featured items must not render a shelf`);
});

test('buildShelves: a shelf at the minimum renders', () => {
  const shelves = build(many(SHELF_MIN, () => ({ featured: true })));
  assert.ok(shelves.some((s) => s.id === 'featured'));
});

test('buildShelves: shelves dedupe against each other in display order', () => {
  // The same 4 bundles are featured AND the most installed. With 37 bundles
  // total this overlap is the normal case, not an edge case.
  const items = many(4, () => ({ featured: true, downloads: 900 }));
  const shelves = build(items);
  const featured = shelves.find((s) => s.id === 'featured');
  const installs = shelves.find((s) => s.id === 'installs');
  assert.ok(featured, 'featured comes first and keeps them');
  assert.equal(installs, undefined, 'installs has nothing left and is suppressed');
});

test('buildShelves: new-this-month uses the injected clock, not Date.now', () => {
  const dates: DateMap = new Map();
  const items = many(SHELF_MIN, (i) => ({ key: `tile:${i}` }));
  for (let i = 0; i < SHELF_MIN; i++) {
    dates.set(`tile:${i}`, { publishedAt: NOW - 60 * 60 * 24, updatedAt: NOW - 60 * 60 * 24 });
  }
  const shelves = build(items, dates);
  assert.ok(shelves.some((s) => s.id === 'new'), 'published yesterday is new');

  const old: DateMap = new Map();
  for (let i = 0; i < SHELF_MIN; i++) {
    old.set(`tile:${i}`, { publishedAt: NOW - 60 * 60 * 24 * 90, updatedAt: NOW });
  }
  const shelves2 = build(items, old);
  assert.equal(shelves2.some((s) => s.id === 'new'), false, '90 days old is not new');
});

test('buildShelves: every shelf declares the facets and sort its "see all" navigates to', () => {
  const shelves = build(many(5, () => ({ featured: true, downloads: 10 })));
  for (const s of shelves) {
    assert.ok(s.facets, `${s.id} must declare facets`);
    assert.ok(s.sort, `${s.id} must declare a sort`);
  }
});

test('buildShelves: removed items never appear on any shelf', () => {
  const shelves = build(many(5, () => ({ featured: true, removed: true })));
  assert.equal(shelves.length, 0);
});

test('buildShelves: a collection becomes a shelf with its items in declared order', () => {
  const items = [
    item({ key: 'tile:b', id: 'b', name: 'B' }),
    item({ key: 'tile:a', id: 'a', name: 'A' }),
    item({ key: 'tile:c', id: 'c', name: 'C' }),
  ];
  const shelves = buildShelves({
    items, dates: new Map(), nowSec: NOW, appVersion: '0.8.0',
    collections: [{ slug: 'kit', title: 'Kit', blurb: null, items: ['c', 'a', 'b'] }],
  });
  const kit = shelves.find((s) => s.id === 'collection:kit')!;
  assert.deepEqual(kit.items.map((i) => i.id), ['c', 'a', 'b'],
    'curated order is the point of a collection; do not re-sort it');
});

test('buildShelves: a collection naming an unknown bundle skips it rather than throwing', () => {
  const shelves = buildShelves({
    items: [item({ key: 'tile:a', id: 'a' })], dates: new Map(), nowSec: NOW, appVersion: '0.8.0',
    collections: [{ slug: 'kit', title: 'Kit', blurb: null, items: ['a', 'ghost'] }],
  });
  assert.deepEqual(shelves.find((s) => s.id === 'collection:kit')!.items.map((i) => i.id), ['a']);
});

test('parseCollections accepts the envelope the live server actually sends', () => {
  // https://market.basedsecurity.net/collections returns {"collections":[...]}
  // where the client expected a bare array. The un-parsed envelope reaching
  // buildShelves is what black-screened the store on open.
  assert.deepEqual(parseCollections({ collections: [] }), []);
  const one = { slug: 's', title: 'T', blurb: null, items: ['a', 'b'] };
  assert.deepEqual(parseCollections({ collections: [one] }), [one]);
  assert.deepEqual(parseCollections([one]), [one]); // bare array still fine
});

test('parseCollections refuses garbage instead of letting it reach a for-of', () => {
  assert.deepEqual(parseCollections(null), []);
  assert.deepEqual(parseCollections(undefined), []);
  assert.deepEqual(parseCollections('nope'), []);
  assert.deepEqual(parseCollections({ collections: 'nope' }), []);
  assert.deepEqual(parseCollections({ collections: [{ slug: 1 }] }), []);
  // Non-string ids inside an otherwise valid collection are dropped, not kept.
  assert.deepEqual(
    parseCollections([{ slug: 's', title: 'T', blurb: 3, items: ['a', 7, 'b'] }]),
    [{ slug: 's', title: 'T', blurb: null, items: ['a', 'b'] }],
  );
});

test('buildShelves survives a raw wire value handed straight in', () => {
  assert.doesNotThrow(() => buildShelves({
    items: [],
    collections: { collections: [] } as unknown as Collection[],
    dates: new Map(),
    nowSec: 0,
    appVersion: '1.0.0',
  }));
});
