import test from 'node:test';
import assert from 'node:assert/strict';
import { FIRST_PARTY_TILES, FIRST_PARTY_VIZ, isFirstParty } from './firstParty';
import { TILE_META } from './tileMeta';
import { BUILTIN_VIZ_STYLES } from '../components/viz-styles';

test('firstParty: every listed tile id is a real built-in tile', () => {
  for (const id of FIRST_PARTY_TILES) {
    assert.ok(id in TILE_META, `${id} is not in TILE_META`);
  }
});

test('firstParty: every listed viz id is a real built-in style', () => {
  const ids = new Set(BUILTIN_VIZ_STYLES.map((s) => s.id));
  for (const id of FIRST_PARTY_VIZ) {
    assert.ok(ids.has(id), `${id} is not in BUILTIN_VIZ_STYLES`);
  }
});

test('firstParty: the set is exactly the 12 documented items', () => {
  assert.equal(FIRST_PARTY_TILES.length, 10);
  assert.equal(FIRST_PARTY_VIZ.length, 2);
});

test('firstParty: isFirstParty discriminates by kind', () => {
  assert.equal(isFirstParty('tile', 'mixer'), true);
  assert.equal(isFirstParty('tile', 'quote'), false);
  assert.equal(isFirstParty('visualizer', 'scripted'), true);
  assert.equal(isFirstParty('visualizer', 'bars'), false);
  // A tile id must not match on the visualizer side.
  assert.equal(isFirstParty('visualizer', 'mixer'), false);
});

test('viz styles: every built-in style carries a category', () => {
  for (const s of BUILTIN_VIZ_STYLES) {
    assert.ok(s.category, `${s.id} has no category`);
  }
});
