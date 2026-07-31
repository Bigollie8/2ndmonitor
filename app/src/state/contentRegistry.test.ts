import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeVizStyles, bundleModeId, isBundleMode, bundleIdOf,
  remapRetiredVizMode, RETIRED_BUILTIN_VIZ_MODES,
  firstAvailableVizMode, resolveVizSurface,
  type InstalledVizFolder,
} from './contentRegistry';
import type { VizStyle } from '../components/viz-styles';
import { BUILTIN_VIZ_STYLES } from '../components/viz-styles';

const builtin: VizStyle[] = [
  { id: 'milkdrop', label: 'MilkDrop', desc: 'Butterchurn', category: 'engine' },
  { id: 'scripted', label: 'Scripted', desc: 'Your JS visualizers', category: 'engine' },
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
  assert.deepEqual(out.map((s) => s.id), ['milkdrop', 'scripted']);
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
  const out = mergeVizStyles(builtin, [folder({ id: 'milkdrop', name: 'Impostor' })]);
  assert.equal(out.filter((s) => s.label === 'Impostor').length, 0);
  assert.equal(out.filter((s) => s.id === 'milkdrop').length, 1);
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

// The whole point of the wave: a user whose saved selection is `bars` must
// land on the Bars BUNDLE, not on a style that no longer exists and not on
// some unrelated default.
test('remapRetiredVizMode: every id retired in this wave maps to its bundle', () => {
  for (const id of ['bars', 'waveform', 'radial', 'particles', 'ambient',
    'neonbars', 'splitmirror', 'circular', 'tunnel', 'pixelled',
    'ribbon', 'vinyl', 'kaleidoscope', 'freqgrid', 'minimal'] as const) {
    assert.equal(remapRetiredVizMode(id), `bundle:${id}`);
  }
});

test('remapRetiredVizMode: surviving builtins are untouched', () => {
  assert.equal(remapRetiredVizMode('milkdrop'), 'milkdrop');
  assert.equal(remapRetiredVizMode('scripted'), 'scripted');
});

test('remapRetiredVizMode: an already-namespaced mode is untouched', () => {
  assert.equal(remapRetiredVizMode('bundle:whatever'), 'bundle:whatever');
});

// Regression: this used to return the literal 'bars', which pointed at a style
// that stopped being compiled in — a black surface, not an error.
test('remapRetiredVizMode: an unknown mode resolves to a style that exists', () => {
  const out = remapRetiredVizMode('nonsense');
  assert.notEqual(out, 'bars');
  assert.ok(BUILTIN_VIZ_STYLES.some((s) => s.id === out), `${out} is not a real style`);
});

test('remapRetiredVizMode: an unknown mode resolves against the list it is given', () => {
  assert.equal(remapRetiredVizMode('nonsense', builtin), 'milkdrop');
  assert.equal(
    remapRetiredVizMode('nonsense', [{ id: 'bundle:aurora' }, { id: 'scripted' }]),
    'bundle:aurora',
    'the fallback is the first surviving entry, whatever it happens to be',
  );
});

test('remapRetiredVizMode: an empty catalog yields null, never an invented id', () => {
  assert.equal(remapRetiredVizMode('nonsense', []), null);
  // A recognisable id still resolves — nothing about an empty table makes a
  // retired id un-remappable, since the bundle it names is not in the table.
  assert.equal(remapRetiredVizMode('bars', []), 'bundle:bars');
});

test('firstAvailableVizMode: the head of the list, or null when empty', () => {
  assert.equal(firstAvailableVizMode([{ id: 'scripted' }, { id: 'milkdrop' }]), 'scripted');
  assert.equal(firstAvailableVizMode([]), null);
});

test('resolveVizSurface: a mode present in the catalog renders itself', () => {
  const styles = [{ id: 'bundle:bars' as const }, { id: 'milkdrop' as const }];
  assert.deepEqual(resolveVizSurface('milkdrop', styles, true), { kind: 'style', mode: 'milkdrop' });
});

test('resolveVizSurface: an absent mode falls back to the first entry that exists', () => {
  const styles = [{ id: 'bundle:aurora' as const }, { id: 'milkdrop' as const }];
  assert.deepEqual(
    resolveVizSurface('bundle:uninstalled', styles, true),
    { kind: 'style', mode: 'bundle:aurora' },
  );
  assert.deepEqual(resolveVizSurface('nonsense', styles, true), { kind: 'style', mode: 'bundle:aurora' });
});

test('resolveVizSurface: an absent mode is "pending", not a guess, until the list loads', () => {
  assert.deepEqual(resolveVizSurface('bundle:aurora', [{ id: 'milkdrop' }], false), { kind: 'pending' });
  // A mode already in the catalog does not wait on the installed list.
  assert.deepEqual(resolveVizSurface('milkdrop', [{ id: 'milkdrop' }], false), { kind: 'style', mode: 'milkdrop' });
});

test('resolveVizSurface: an empty catalog is an explicit empty state, not a black void', () => {
  assert.deepEqual(resolveVizSurface('bundle:bars', [], true), { kind: 'empty' });
  assert.deepEqual(resolveVizSurface('milkdrop', [], true), { kind: 'empty' });
  // Still pending before the list resolves, even with nothing to show.
  assert.deepEqual(resolveVizSurface('bundle:bars', [], false), { kind: 'pending' });
});

test('RETIRED_BUILTIN_VIZ_MODES: covers all 27 migrated styles, with no duplicates', () => {
  assert.equal(RETIRED_BUILTIN_VIZ_MODES.length, 27);
  assert.equal(new Set(RETIRED_BUILTIN_VIZ_MODES).size, 27);
});

test('BUILTIN_VIZ_STYLES: only the two first-party engines are compiled in', () => {
  assert.deepEqual(BUILTIN_VIZ_STYLES.map((s) => s.id), ['milkdrop', 'scripted']);
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
