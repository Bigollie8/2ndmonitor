import test from 'node:test';
import assert from 'node:assert/strict';
import { identiconCells, identiconDataUri } from './identicon';

test('the same seed always produces the same avatar', () => {
  // Stability is the whole contract: a creator's face must not change when
  // they reopen the app, or between two people looking at the same profile.
  assert.equal(identiconDataUri('oliver'), identiconDataUri('oliver'));
  assert.deepEqual(identiconCells('oliver'), identiconCells('oliver'));
});

test('different seeds produce different avatars', () => {
  assert.notEqual(identiconDataUri('oliver'), identiconDataUri('annabel'));
});

// Neighbouring handles are the realistic case -- oliver, oliver1, oliver2 --
// and they must not look like each other.
test('seeds that differ by one character still look different', () => {
  const a = identiconDataUri('oliver');
  const b = identiconDataUri('oliver1');
  const c = identiconDataUri('oliver2');
  assert.notEqual(a, b);
  assert.notEqual(b, c);
  assert.notEqual(a, c);
});

test('the grid is 5x5 and mirrored, so it reads as a glyph not noise', () => {
  const cells = identiconCells('anything');
  assert.equal(cells.length, 5);
  for (const row of cells) {
    assert.equal(row.length, 5);
    assert.equal(row[0], row[4], 'column 5 mirrors column 1');
    assert.equal(row[1], row[3], 'column 4 mirrors column 2');
  }
});

test('the result is an inline SVG data URI, needing no request and no CSP change', () => {
  const uri = identiconDataUri('oliver');
  assert.ok(uri.startsWith('data:image/svg+xml'));
  assert.ok(uri.includes('svg'));
});

test('an empty seed still yields a valid avatar rather than throwing', () => {
  const uri = identiconDataUri('');
  assert.ok(uri.startsWith('data:image/svg+xml'));
});

test('size is honoured', () => {
  assert.ok(decodeURIComponent(identiconDataUri('x', 128)).includes('width="128"'));
});
