import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeVizStyles, bundleModeId, isBundleMode, bundleIdOf,
  remapRetiredVizMode, RETIRED_BUILTIN_VIZ_MODES,
  type InstalledVizFolder,
} from './contentRegistry';
import type { VizStyle } from '../components/viz-styles';
import { BUILTIN_VIZ_STYLES } from '../components/viz-styles';

const builtin: VizStyle[] = [
  { id: 'bars', label: 'Bars', desc: 'Classic spectrum analyzer' },
  { id: 'milkdrop', label: 'MilkDrop', desc: 'Butterchurn' },
  { id: 'scripted', label: 'Scripted', desc: 'Your JS visualizers' },
];

const folder = (over: Partial<InstalledVizFolder> = {}): InstalledVizFolder => ({
  id: 'starfield', name: 'Starfield', author: 'official', version: '1.0.0',
  api: 1, manifest_error: null, source: 'marketplace', ...over,
});

test('bundleModeId / isBundleMode / bundleIdOf round-trip', () => {
  const mode = bundleModeId('starfield');
  assert.equal(mode, 'bundle:starfield');
  assert.equal(isBundleMode(mode), true);
  assert.equal(isBundleMode('bars'), false);
  assert.equal(bundleIdOf(mode), 'starfield');
  assert.equal(bundleIdOf('bars'), null);
});

test('mergeVizStyles: no installed content leaves builtins untouched', () => {
  const out = mergeVizStyles(builtin, []);
  assert.deepEqual(out.map((s) => s.id), ['bars', 'milkdrop', 'scripted']);
  assert.equal(out.every((s) => s.source === 'builtin'), true);
});

test('mergeVizStyles: an installed bundle becomes a first-class style', () => {
  const out = mergeVizStyles(builtin, [folder()]);
  const entry = out.find((s) => s.id === 'bundle:starfield');
  assert.ok(entry);
  assert.equal(entry.label, 'Starfield');
  assert.equal(entry.source, 'bundle');
  assert.equal(entry.bundleId, 'starfield');
});

test('mergeVizStyles: skips folders with a manifest error', () => {
  const out = mergeVizStyles(builtin, [folder({ manifest_error: 'bad json' })]);
  assert.equal(out.some((s) => s.source === 'bundle'), false);
});

test('mergeVizStyles: skips folders declaring an unsupported api', () => {
  const out = mergeVizStyles(builtin, [folder({ api: 2 }), folder({ id: 'x', api: null })]);
  assert.equal(out.some((s) => s.source === 'bundle'), false);
});

test('mergeVizStyles: scripted stays last so the authoring entry is not buried', () => {
  const out = mergeVizStyles(builtin, [folder(), folder({ id: 'aurora-bundle', name: 'Aurora' })]);
  assert.equal(out[out.length - 1]?.id, 'scripted');
});

test('mergeVizStyles: bundles sort by label among themselves', () => {
  const out = mergeVizStyles(builtin, [
    folder({ id: 'zeta', name: 'Zeta' }),
    folder({ id: 'alpha', name: 'Alpha' }),
  ]);
  const bundles = out.filter((s) => s.source === 'bundle').map((s) => s.label);
  assert.deepEqual(bundles, ['Alpha', 'Zeta']);
});

test('mergeVizStyles: a bundle id colliding with a builtin does not shadow it', () => {
  const out = mergeVizStyles(builtin, [folder({ id: 'bars', name: 'Impostor' })]);
  assert.equal(out.filter((s) => s.label === 'Impostor').length, 0);
  assert.equal(out.filter((s) => s.id === 'bars').length, 1);
});

test('mergeVizStyles: a nameless folder falls back to its id as the label', () => {
  const out = mergeVizStyles(builtin, [folder({ name: '' })]);
  assert.equal(out.find((s) => s.source === 'bundle')?.label, 'starfield');
});

test('BUILTIN_VIZ_STYLES: every entry has a unique id and non-empty label', () => {
  const ids = BUILTIN_VIZ_STYLES.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(BUILTIN_VIZ_STYLES.every((s) => s.label.trim().length > 0), true);
});

test('BUILTIN_VIZ_STYLES: no builtin id uses the bundle namespace', () => {
  assert.equal(BUILTIN_VIZ_STYLES.some((s) => isBundleMode(s.id)), false);
});

test('mergeVizStyles: real builtin table plus a bundle keeps every builtin', () => {
  // NOTE: folder()'s default id ('starfield') collides with a real builtin
  // id in BUILTIN_VIZ_STYLES, which mergeVizStyles correctly drops (see the
  // "does not shadow it" test above) — that would sink this count assertion
  // for a reason unrelated to what it's checking. Use an id no builtin has.
  const out = mergeVizStyles(BUILTIN_VIZ_STYLES, [folder({ id: 'sample-bundle', name: 'Sample Bundle' })]);
  assert.equal(out.length, BUILTIN_VIZ_STYLES.length + 1);
});

test('remapRetiredVizMode: a retired builtin id maps to its bundle id', () => {
  assert.equal(remapRetiredVizMode('starfield'), 'bundle:starfield');
  assert.equal(remapRetiredVizMode('spectrogram'), 'bundle:spectrogram');
});

test('remapRetiredVizMode: surviving builtins are untouched', () => {
  assert.equal(remapRetiredVizMode('bars'), 'bars');
  assert.equal(remapRetiredVizMode('milkdrop'), 'milkdrop');
});

test('remapRetiredVizMode: an already-namespaced mode is untouched', () => {
  assert.equal(remapRetiredVizMode('bundle:whatever'), 'bundle:whatever');
});

test('remapRetiredVizMode: an unknown mode falls back to bars', () => {
  assert.equal(remapRetiredVizMode('nonsense'), 'bars');
});

test('RETIRED_BUILTIN_VIZ_MODES: covers exactly the 12 migrated styles', () => {
  assert.equal(RETIRED_BUILTIN_VIZ_MODES.length, 12);
});

test('mergeVizStyles: a local draft is not published into the catalog', () => {
  const out = mergeVizStyles(builtin, [folder({ id: 'draft', name: 'My Visualizer', source: 'local' })]);
  assert.equal(out.some((s) => s.source === 'bundle'), false);
});

test('mergeVizStyles: a marketplace folder still appears', () => {
  const out = mergeVizStyles(builtin, [folder({ id: 'sample-bundle', source: 'marketplace' })]);
  assert.equal(out.some((s) => s.id === 'bundle:sample-bundle'), true);
});

test('mergeVizStyles: a marketplace folder that failed validation is skipped', () => {
  const out = mergeVizStyles(builtin, [
    folder({ id: 'sample-bundle', source: 'marketplace', manifest_error: 'main.js missing' }),
  ]);
  assert.equal(out.some((s) => s.source === 'bundle'), false);
});
