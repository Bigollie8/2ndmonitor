import test from 'node:test';
import assert from 'node:assert/strict';
import { rowPlanFor, sectionFacets } from './libraryRows';
import type { CatalogItem } from './catalog';

const item = (o: Partial<CatalogItem> = {}): CatalogItem => ({
  key: 'tile:x', kind: 'tile', id: 'x', name: 'X', description: '', category: 'weather',
  source: 'bundle', installed: true, installedVersion: '1.0.0', availableVersion: '1.0.0',
  updateAvailable: false, permissions: [], needsSetup: false, downloads: 0, brokenReason: null,
  removed: false, hasPreview: false, rating: null,
  summary: null, tags: [], icon: null, changelog: null, minAppVersion: null,
  featured: false, approvedAt: null, mediaCount: 0, authorDisplay: null, ...o,
});

const APP = '0.8.0';

test('an installed marketplace tile offers add and remove', () => {
  const p = rowPlanFor(item(), APP);
  assert.deepEqual(p.actions, ['add', 'remove']);
  assert.equal(p.removeLabel, 'Remove');
});

// The honesty fix: planRemoval only uninstalls when installedVersion is set.
// For a compiled-in tile it just writes a tombstone, so "Remove" overstates
// what the button does.
test('a first-party built-in says Hide, not Remove', () => {
  const p = rowPlanFor(item({ source: 'first-party', installedVersion: null }), APP);
  assert.equal(p.removeLabel, 'Hide');
  assert.ok(p.actions.includes('hide'));
  assert.equal(p.actions.includes('remove'), false);
});

test('a visualizer has no add action -- there is no dashboard instance to place', () => {
  const p = rowPlanFor(item({ kind: 'visualizer' }), APP);
  assert.equal(p.actions.includes('add'), false);
});

test('a preset has no add action either', () => {
  assert.equal(rowPlanFor(item({ kind: 'preset' }), APP).actions.includes('add'), false);
});

test('an item awaiting a credential offers setup first', () => {
  const p = rowPlanFor(item({ needsSetup: true }), APP);
  assert.equal(p.actions[0], 'setup', 'the blocking action leads');
});

test('an updatable item offers update before remove', () => {
  const p = rowPlanFor(item({ updateAvailable: true, availableVersion: '1.1.0' }), APP);
  assert.ok(p.actions.indexOf('update') < p.actions.indexOf('remove'));
});

test('a removed item offers only restore', () => {
  const p = rowPlanFor(item({ removed: true, installed: false }), APP);
  assert.deepEqual(p.actions, ['restore']);
});

test('an incompatible item carries a note and cannot be updated into', () => {
  const p = rowPlanFor(item({ updateAvailable: true, minAppVersion: '0.9.0' }), APP);
  assert.ok(p.incompatibleNote?.includes('0.9.0'));
  assert.equal(p.actions.includes('update'), false,
    'offering an update the app cannot run would fail confusingly at install time');
});

test('a compatible item carries no note', () => {
  assert.equal(rowPlanFor(item({ minAppVersion: '0.8.0' }), APP).incompatibleNote, null);
});

test('a broken install can still be removed -- that is why the catalog shows it at all', () => {
  const p = rowPlanFor(item({ brokenReason: 'manifest invalid' }), APP);
  assert.ok(p.actions.includes('remove'));
  assert.equal(p.actions.includes('add'), false, 'placing a broken tile would draw an error frame');
});

test('sectionFacets maps each section to the facets that select it', () => {
  assert.equal(sectionFacets('installed').installed, true);
  assert.equal(sectionFacets('updates').updates, true);
  assert.equal(sectionFacets('needs-setup').needsSetup, true);
  assert.equal(sectionFacets('removed').removed, true);
});
