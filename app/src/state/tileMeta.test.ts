import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TILE_META } from './tileMeta';
import { ALL_TILE_TYPES } from './layout';

test('registry covers every tile type exactly once', () => {
  const keys = Object.keys(TILE_META).sort();
  assert.deepEqual(keys, [...ALL_TILE_TYPES].sort());
});

test('every entry has non-empty presentation fields', () => {
  for (const type of ALL_TILE_TYPES) {
    const m = TILE_META[type];
    assert.ok(m.icon.length > 0, `${type} icon`);
    assert.ok(m.label.length > 0, `${type} label`);
    assert.ok(m.description.length > 0, `${type} description`);
  }
});
