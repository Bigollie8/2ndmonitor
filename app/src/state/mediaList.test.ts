import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaRefsFor, hasGallery } from './mediaList';
import type { CatalogItem } from './catalog';

const item = (o: Partial<CatalogItem> = {}): CatalogItem => ({
  key: 'tile:x', kind: 'tile', id: 'x', name: 'X', description: '', category: 'weather',
  source: 'bundle', installed: false, installedVersion: null, availableVersion: '1.0.0',
  updateAvailable: false, permissions: [], needsSetup: false, downloads: 0, brokenReason: null,
  removed: false, hasPreview: false, rating: null,
  summary: null, tags: [], icon: null, changelog: null, minAppVersion: null,
  featured: false, approvedAt: null, mediaCount: 0, authorDisplay: null, authorHandle: null, ...o,
});

test('no media and no legacy preview yields nothing to show', () => {
  assert.deepEqual(mediaRefsFor(item()), []);
  assert.equal(hasGallery(item()), false);
});

// The 37 bundles published before Market v2 have a preview blob and zero
// media rows. /preview aliases media index 0, so index 0 is exactly right.
test('a legacy preview with no media rows still yields one asset at index 0', () => {
  const refs = mediaRefsFor(item({ hasPreview: true, mediaCount: 0 }));
  assert.deepEqual(refs, [{ idx: 0, isHero: true }]);
  assert.equal(hasGallery(item({ hasPreview: true, mediaCount: 0 })), false,
    'one asset is a hero, not a gallery');
});

test('media rows produce one ref each, index 0 the hero', () => {
  const refs = mediaRefsFor(item({ hasPreview: true, mediaCount: 4 }));
  assert.equal(refs.length, 4);
  assert.equal(refs[0].isHero, true);
  assert.equal(refs.filter((r) => r.isHero).length, 1);
  assert.deepEqual(refs.map((r) => r.idx), [0, 1, 2, 3]);
});

test('a gallery needs more than one asset', () => {
  assert.equal(hasGallery(item({ hasPreview: true, mediaCount: 2 })), true);
  assert.equal(hasGallery(item({ hasPreview: true, mediaCount: 1 })), false);
});

test('mediaCount is clamped to the server-side cap, so a bad index cannot 404 the strip', () => {
  assert.equal(mediaRefsFor(item({ hasPreview: true, mediaCount: 99 })).length, 6);
});

test('a first-party built-in never has published media', () => {
  // It is not a marketplace bundle, so there is no (id, version) to fetch.
  assert.deepEqual(mediaRefsFor(item({ source: 'first-party', hasPreview: true, mediaCount: 3 })), []);
});
