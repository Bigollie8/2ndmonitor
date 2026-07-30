import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRemovals, withRemoval, withoutRemoval } from './removedContent';

test('applyRemovals: drops matching ids for the given kind', () => {
  const out = applyRemovals(['visualizer:bars'], [{ id: 'bars' }, { id: 'radial' }], 'visualizer');
  assert.deepEqual(out.map((s) => s.id), ['radial']);
});

test('applyRemovals: a tile removal does not affect a visualizer of the same id', () => {
  const out = applyRemovals(['tile:vinyl'], [{ id: 'vinyl' }], 'visualizer');
  assert.deepEqual(out.map((s) => s.id), ['vinyl']);
});

test('applyRemovals: strips the bundle: prefix before matching', () => {
  const out = applyRemovals(['visualizer:aurora'], [{ id: 'bundle:aurora' }], 'visualizer');
  assert.deepEqual(out, []);
});

test('applyRemovals: an empty removal list is identity', () => {
  const input = [{ id: 'bars' }, { id: 'radial' }];
  assert.deepEqual(applyRemovals([], input, 'visualizer'), input);
});

test('withRemoval: is idempotent', () => {
  assert.deepEqual(withRemoval(['tile:x'], 'tile:x'), ['tile:x']);
  assert.deepEqual(withRemoval([], 'tile:x'), ['tile:x']);
});

test('withoutRemoval: drops only the named key', () => {
  assert.deepEqual(withoutRemoval(['tile:x', 'tile:y'], 'tile:x'), ['tile:y']);
});
