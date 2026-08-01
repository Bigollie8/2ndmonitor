import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRemovals, withRemoval, withoutRemoval, restoreItem } from './removedContent';

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

test('withoutRemoval: is idempotent — dropping an absent key returns the SAME array reference', () => {
  // Mirrors withRemoval's idempotency (see the test above). Array.filter
  // always allocates, so without an includes() short-circuit, every install
  // rewrote catalog.removed in the tweaks store even for something that was
  // never tombstoned (a minor from the whole-branch review).
  const removed = ['tile:x', 'tile:y'];
  assert.equal(withoutRemoval(removed, 'tile:z'), removed);
  const empty: string[] = [];
  assert.equal(withoutRemoval(empty, 'tile:z'), empty);
});

// restoreItem — the per-item Restore action behind the "Removed" rail row's
// card (ContentLibrary.tsx's handleRestore). Critical 2's fix: unlike
// restoreDefaults (state/catalog.ts), which always clears EVERYTHING and
// calls seedSync([]), this drops only one key and re-syncs against the
// NARROWED list, so every other tombstone stays honored.

test('restoreItem: drops only the named key from the removal list', async () => {
  let written: string[] | null = null;
  await restoreItem('tile:x', {
    removed: ['tile:x', 'tile:y'],
    setRemoved: (next) => { written = next; },
    seedSync: async () => [],
  });
  assert.deepEqual(written, ['tile:y']);
});

test('restoreItem: seedSync receives the SAME narrowed list, not [] and not the stale one', () => {
  let seenBySync: string[] | null = null;
  return restoreItem('tile:x', {
    removed: ['tile:x', 'tile:y'],
    setRemoved: () => {},
    seedSync: async (removed) => { seenBySync = removed; return []; },
  }).then(() => {
    assert.deepEqual(seenBySync, ['tile:y'], 'tile:y must stay skipped by seed_sync');
  });
});

test('restoreItem: propagates the installed keys seedSync returns', async () => {
  const result = await restoreItem('tile:x', {
    removed: ['tile:x'],
    setRemoved: () => {},
    seedSync: async () => ['tile:x'],
  });
  assert.deepEqual(result, ['tile:x']);
});

test('restoreItem: restoring a key that was never removed is a harmless no-op on the list', async () => {
  let written: string[] | null = null;
  await restoreItem('tile:never-removed', {
    removed: ['tile:x'],
    setRemoved: (next) => { written = next; },
    seedSync: async (removed) => removed,
  });
  assert.deepEqual(written, ['tile:x']);
});
