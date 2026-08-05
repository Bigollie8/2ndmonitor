import test from 'node:test';
import assert from 'node:assert/strict';
import { searchItems, scoreItem } from './catalogSearch';
import type { CatalogItem } from '../state/catalog';

const item = (o: Partial<CatalogItem> = {}): CatalogItem => ({
  key: 'tile:x', kind: 'tile', id: 'x', name: 'X', description: '', category: 'weather',
  source: 'bundle', installed: false, installedVersion: null, availableVersion: '1.0.0',
  updateAvailable: false, permissions: [], needsSetup: false, downloads: 0, brokenReason: null,
  removed: false, hasPreview: false, rating: null,
  summary: null, tags: [], icon: null, changelog: null, minAppVersion: null,
  featured: false, approvedAt: null, mediaCount: 0, authorDisplay: null, authorHandle: null, ...o,
});

const named = (name: string, description = ''): CatalogItem =>
  item({ key: `tile:${name}`, id: name, name, description });

test('searchItems: matches name case-insensitively', () => {
  assert.equal(searchItems([named('Aurora')], 'aur').length, 1);
});

test('searchItems: matches description', () => {
  assert.equal(searchItems([named('X', 'spinning record')], 'record').length, 1);
});

test('searchItems: an empty query is identity', () => {
  const items = [named('A'), named('B')];
  assert.deepEqual(searchItems(items, '   '), items);
});

test('searchItems: no match yields an empty list', () => {
  assert.deepEqual(searchItems([named('Aurora')], 'zzz'), []);
});

test('searchItems: a name hit outranks a description hit', () => {
  const out = searchItems([
    item({ key: 'a', id: 'a', name: 'Nothing', description: 'all about radar' }),
    item({ key: 'b', id: 'b', name: 'Radar', description: 'unrelated' }),
  ], 'radar');
  assert.deepEqual(out.map((i) => i.id), ['b', 'a']);
});

test('searchItems: tags and summary are searchable at all', () => {
  const out = searchItems([
    item({ key: 'a', id: 'a', name: 'A', tags: ['lightning'] }),
    item({ key: 'b', id: 'b', name: 'B', summary: 'shows lightning strikes' }),
    item({ key: 'c', id: 'c', name: 'C' }),
  ], 'lightning');
  assert.deepEqual(out.map((i) => i.id).sort(), ['a', 'b'], 'C must not match');
});

test('searchItems: a tag hit outranks a summary hit', () => {
  const out = searchItems([
    item({ key: 'a', id: 'a', name: 'A', summary: 'about weather' }),
    item({ key: 'b', id: 'b', name: 'B', tags: ['weather'] }),
  ], 'weather');
  assert.deepEqual(out.map((i) => i.id), ['b', 'a']);
});

test('searchItems: an exact name match outranks a prefix, which outranks a substring', () => {
  const out = searchItems([
    item({ key: 'a', id: 'a', name: 'Superradar' }),
    item({ key: 'b', id: 'b', name: 'Radar' }),
    item({ key: 'c', id: 'c', name: 'Radar plus' }),
  ], 'radar');
  assert.deepEqual(out.map((i) => i.id), ['b', 'c', 'a']);
});

test('searchItems: the author is searchable', () => {
  const out = searchItems([
    item({ key: 'a', id: 'a', name: 'A', authorDisplay: 'oli***' }),
    item({ key: 'b', id: 'b', name: 'B' }),
  ], 'oli');
  assert.deepEqual(out.map((i) => i.id), ['a']);
});

test('searchItems: a blank query is still identity, in the original order', () => {
  const items = [item({ key: 'z', id: 'z', name: 'Z' }), item({ key: 'a', id: 'a', name: 'A' })];
  assert.deepEqual(searchItems(items, '   ').map((i) => i.id), ['z', 'a']);
});

test('scoreItem returns 0 for a miss', () => {
  assert.equal(scoreItem(item({ name: 'Radar' }), 'zzz'), 0);
});

test('scoreItem survives the null fields the live index actually carries', () => {
  // The marketplace index returns `"description": null` (and null summary /
  // authorDisplay) on submitted items. Before 0.8.5 description was the one
  // field accessed without optional chaining, so searching threw a TypeError
  // mid-render — and with no error boundary that blanked the whole app.
  const item = {
    key: 'v:x', kind: 'visualizer', id: 'x', name: 'Nebula',
    tags: [], description: null, summary: null, authorDisplay: null,
  } as unknown as Parameters<typeof scoreItem>[0];
  assert.doesNotThrow(() => scoreItem(item, 'neb'));
  assert.ok(scoreItem(item, 'neb') > 0, 'name match must still score');
  assert.equal(scoreItem(item, 'zzzz'), 0);
});
