import { test } from 'node:test';
import assert from 'node:assert/strict';

// Importing useTweaks.ts pulls in React, which is fine under tsx as long as
// no hook/component is invoked — we only use the pure mergeTweaks/isPlainObject helpers.
import { mergeTweaks, isPlainObject } from './useTweaks';

test('isPlainObject: rejects arrays', () => {
  assert.equal(isPlainObject([1, 2, 3]), false);
  assert.equal(isPlainObject([]), false);
});

test('isPlainObject: rejects strings and other primitives', () => {
  assert.equal(isPlainObject('oops'), false);
  assert.equal(isPlainObject(42), false);
  assert.equal(isPlainObject(true), false);
  assert.equal(isPlainObject(undefined), false);
});

test('isPlainObject: rejects null', () => {
  assert.equal(isPlainObject(null), false);
});

test('isPlainObject: accepts plain objects', () => {
  assert.equal(isPlainObject({}), true);
  assert.equal(isPlainObject({ a: 1 }), true);
});

test('mergeTweaks: flat loaded values override defaults', () => {
  const defaults = { theme: 'dark', fontSize: 14, showClock: true };
  const out = mergeTweaks(defaults, { fontSize: 18, showClock: false });
  assert.deepEqual(out, { theme: 'dark', fontSize: 18, showClock: false });
});

test('mergeTweaks: one-level nested objects merge field-wise', () => {
  const defaults = { weatherLocation: { lat: 35.96, lon: -83.92, name: 'Knoxville' } };
  const out = mergeTweaks(defaults, { weatherLocation: { lat: 1 } });
  // lat overridden, lon and name preserved from defaults
  assert.deepEqual(out.weatherLocation, { lat: 1, lon: -83.92, name: 'Knoxville' });
});

test('mergeTweaks: nested merge is one level only — loaded field wins wholesale inside', () => {
  const defaults = { viz: { colors: { accent: 'red', accent2: 'blue' }, speed: 1 } };
  const out = mergeTweaks(defaults, { viz: { colors: { accent: 'green' } } });
  // Depth-2 object is replaced, not merged: accent2 is dropped.
  assert.deepEqual(out.viz, { colors: { accent: 'green' }, speed: 1 });
});

test('mergeTweaks: arrays replace, never merge', () => {
  const defaults = { bookmarks: ['a', 'b', 'c'], tags: [1, 2] };
  const out = mergeTweaks(defaults, { bookmarks: ['x'] });
  assert.deepEqual(out.bookmarks, ['x']);
  assert.deepEqual(out.tags, [1, 2]);

  // Loaded array over object default also replaces (no object-spread of an array).
  const d2 = { thing: { a: 1 } as unknown };
  const o2 = mergeTweaks(d2, { thing: [1, 2] });
  assert.deepEqual(o2.thing, [1, 2]);

  // Loaded object over array default replaces too.
  const d3 = { list: [1, 2, 3] as unknown };
  const o3 = mergeTweaks(d3, { list: { a: 1 } });
  assert.deepEqual(o3.list, { a: 1 });
});

test('mergeTweaks: null loaded values replace defaults', () => {
  const defaults = { color: 'red' as string | null, loc: { lat: 1, lon: 2 } as object | null };
  const out = mergeTweaks(defaults, { color: null, loc: null });
  assert.equal(out.color, null);
  assert.equal(out.loc, null);
});

test('mergeTweaks: keys only in loaded are kept', () => {
  const defaults = { a: 1 };
  const out = mergeTweaks(defaults, { legacyKey: 'still here' });
  assert.equal((out as Record<string, unknown>).legacyKey, 'still here');
  assert.equal(out.a, 1);
});

test('mergeTweaks: keys only in defaults survive', () => {
  const defaults = { a: 1, b: { x: true }, c: 'keep' };
  const out = mergeTweaks(defaults, {});
  assert.deepEqual(out, defaults);
});

test('mergeTweaks: does not mutate the defaults object', () => {
  const defaults = { loc: { lat: 1, lon: 2 }, n: 5 };
  const snapshot = JSON.parse(JSON.stringify(defaults));
  mergeTweaks(defaults, { loc: { lat: 99 }, n: 6 });
  assert.deepEqual(defaults, snapshot);
});
