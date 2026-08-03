import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRail } from './catalogRail';
import type { CatalogItem } from '../state/catalog';

const item = (o: Partial<CatalogItem> = {}): CatalogItem => ({
  key: 'tile:x', kind: 'tile', id: 'x', name: 'X', description: '', category: 'weather',
  source: 'bundle', installed: false, installedVersion: null, availableVersion: '1.0.0',
  updateAvailable: false, permissions: [], needsSetup: false, downloads: 0, brokenReason: null,
  removed: false, hasPreview: false, rating: null,
  summary: null, tags: [], icon: null, changelog: null, minAppVersion: null,
  featured: false, approvedAt: null, mediaCount: 0, authorDisplay: null, ...o,
});

test('buildRail: All counts every item', () => {
  const rail = buildRail([item(), item({ key: 'tile:y', id: 'y' })]);
  assert.equal(rail.find((r) => r.id === 'all')?.count, 2);
});

test('buildRail: Installed and Updates count only what qualifies', () => {
  const rail = buildRail([
    item({ installed: true }),
    item({ key: 'tile:y', id: 'y', installed: true, updateAvailable: true }),
    item({ key: 'tile:z', id: 'z' }),
  ]);
  assert.equal(rail.find((r) => r.id === 'installed')?.count, 2);
  assert.equal(rail.find((r) => r.id === 'updates')?.count, 1);
});

test('buildRail: category rows appear per kind and omit empty categories', () => {
  const rail = buildRail([item({ category: 'weather' })]);
  assert.ok(rail.some((r) => r.id === 'tile:weather' && r.count === 1));
  assert.equal(rail.some((r) => r.id === 'tile:system'), false);
});

test('buildRail: needsSetup row counts items awaiting a credential', () => {
  const rail = buildRail([item({ installed: true, needsSetup: true })]);
  assert.equal(rail.find((r) => r.id === 'needs-setup')?.count, 1);
});

// Critical 2 (whole-branch review): removed items stay in mergeCatalog's
// output (flagged, not dropped — see catalog.ts) purely so this rail row can
// name them for a per-item Restore action. Every other row must keep
// excluding them, or a tombstoned item would double-count in "All" and its
// category.

test('buildRail: a removed item is absent from All, Installed and its category', () => {
  const rail = buildRail([
    item({ key: 'tile:x', id: 'x', installed: true, removed: false }),
    item({ key: 'tile:y', id: 'y', installed: true, removed: true }),
  ]);
  assert.equal(rail.find((r) => r.id === 'all')?.count, 1, 'removed item excluded from All');
  assert.equal(rail.find((r) => r.id === 'installed')?.count, 1, 'removed item excluded from Installed');
  assert.equal(rail.find((r) => r.id === 'tile:weather')?.count, 1, 'removed item excluded from its category');
});

test('buildRail: the Removed row counts only removed items, and is absent at zero', () => {
  const noneRemoved = buildRail([item({ removed: false })]);
  assert.equal(noneRemoved.some((r) => r.id === 'removed'), false, 'hidden when nothing is removed');

  const oneRemoved = buildRail([item({ removed: false }), item({ key: 'tile:y', id: 'y', removed: true })]);
  assert.equal(oneRemoved.find((r) => r.id === 'removed')?.count, 1);
});

test('buildRail: a category heading count excludes removed items too', () => {
  const rail = buildRail([
    item({ key: 'tile:x', id: 'x', category: 'weather', removed: false }),
    item({ key: 'tile:y', id: 'y', category: 'weather', removed: true }),
  ]);
  const heading = rail.find((r) => r.id === 'heading:tile');
  assert.equal(heading?.count, 1, 'the tile heading counts only the visible item');
});

// preset kind — Task 4 admits MilkDrop presets into the rail as one
// selectable row (not per-category, unlike tiles/visualizers) after the
// tile/visualizer sections.

test('buildRail: presets present produce a MilkDrop heading and a Presets row with the right count', () => {
  const rail = buildRail([
    item({ key: 'preset:a', id: 'a', kind: 'preset', category: 'milkdrop' }),
    item({ key: 'preset:b', id: 'b', kind: 'preset', category: 'milkdrop' }),
  ]);
  const heading = rail.find((r) => r.id === 'heading:preset');
  assert.ok(heading);
  assert.equal(heading?.label, 'MilkDrop');
  assert.equal(heading?.count, 2);
  const row = rail.find((r) => r.id === 'preset:all');
  assert.ok(row);
  assert.equal(row?.label, 'Presets');
  assert.equal(row?.count, 2);
});

test('buildRail: a removed preset is excluded from the Presets row and heading count', () => {
  const rail = buildRail([
    item({ key: 'preset:a', id: 'a', kind: 'preset', category: 'milkdrop', removed: false }),
    item({ key: 'preset:b', id: 'b', kind: 'preset', category: 'milkdrop', removed: true }),
  ]);
  assert.equal(rail.find((r) => r.id === 'heading:preset')?.count, 1);
  assert.equal(rail.find((r) => r.id === 'preset:all')?.count, 1);
});

test('buildRail: no presets means no preset heading or row', () => {
  const rail = buildRail([item()]);
  assert.equal(rail.some((r) => r.id === 'preset:all'), false);
  assert.equal(rail.some((r) => r.id === 'heading:preset'), false);
});
