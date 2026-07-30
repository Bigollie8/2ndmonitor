import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogCardTags } from './CatalogCard';
import type { CatalogItem } from '../state/catalog';

const item = (o: Partial<CatalogItem> = {}): CatalogItem => ({
  key: 'tile:x', kind: 'tile', id: 'x', name: 'X', description: '', category: 'weather',
  source: 'bundle', installed: false, installedVersion: null, availableVersion: '1.0.0',
  updateAvailable: false, permissions: [], needsSetup: false, downloads: 0, brokenReason: null,
  removed: false, hasPreview: false, ...o,
});

test('catalogCardTags: broken beats every other condition', () => {
  const tags = catalogCardTags(item({
    brokenReason: 'manifest invalid', updateAvailable: true, installed: true, needsSetup: true,
    source: 'first-party',
  }));
  assert.equal(tags[0]?.text, 'error');
});

test('catalogCardTags: update ranks above needs-key and core', () => {
  const tags = catalogCardTags(item({
    installed: true, updateAvailable: true, needsSetup: true, source: 'first-party',
  }));
  assert.equal(tags[0]?.text, 'update');
  assert.equal(tags[1]?.text, 'needs key');
});

test('catalogCardTags: needs-key requires installed, not just needsSetup', () => {
  const tags = catalogCardTags(item({ installed: false, needsSetup: true }));
  assert.equal(tags.some((t) => t.text === 'needs key'), false);
});

test('catalogCardTags: first-party source shows core', () => {
  const tags = catalogCardTags(item({ installed: true, source: 'first-party' }));
  assert.deepEqual(tags.map((t) => t.text), ['core']);
});

test('catalogCardTags: uninstalled with zero downloads shows new', () => {
  const tags = catalogCardTags(item({ installed: false, downloads: 0 }));
  assert.deepEqual(tags.map((t) => t.text), ['new']);
});

test('catalogCardTags: uninstalled with null downloads does not show new', () => {
  const tags = catalogCardTags(item({ installed: false, downloads: null }));
  assert.equal(tags.some((t) => t.text === 'new'), false);
});

test('catalogCardTags: caps at two even when four conditions match', () => {
  const tags = catalogCardTags(item({
    brokenReason: 'x', updateAvailable: true, installed: true, needsSetup: true, source: 'first-party',
  }));
  assert.equal(tags.length, 2);
  assert.deepEqual(tags.map((t) => t.text), ['error', 'update']);
});

test('catalogCardTags: clean installed first-party item with no issues shows only core', () => {
  const tags = catalogCardTags(item({ installed: true, source: 'first-party', downloads: null }));
  assert.deepEqual(tags.map((t) => t.text), ['core']);
});

test('catalogCardTags: nothing matches → empty', () => {
  const tags = catalogCardTags(item({ installed: true, downloads: 5 }));
  assert.deepEqual(tags, []);
});

test('catalogCardTags: removed outranks every other condition', () => {
  const tags = catalogCardTags(item({
    removed: true, brokenReason: 'x', updateAvailable: true, installed: true,
    needsSetup: true, source: 'first-party',
  }));
  assert.deepEqual(tags.map((t) => t.text), ['removed'], 'removed is the only tag shown');
});
