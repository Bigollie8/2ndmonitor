import test from 'node:test';
import assert from 'node:assert/strict';
import { seedStarterProfiles, STARTER_TILE_SETS } from './starterProfiles';
import { ALL_TILE_TYPES, DEFAULT_LANDSCAPE_LAYOUT, DEFAULT_PORTRAIT_LAYOUT } from './layout';

test('seedStarterProfiles: three profiles named Work/Gaming/Chill', () => {
  const profiles = seedStarterProfiles();
  assert.equal(profiles.length, 3);
  assert.deepEqual(profiles.map((p) => p.name), ['Work', 'Gaming', 'Chill']);
  for (const p of profiles) {
    assert.ok(p.id.length > 0);
    assert.ok(p.color.startsWith('#'));
  }
});

test('seedStarterProfiles: curated tile subsets, never the full catalog', () => {
  const profiles = seedStarterProfiles();
  const expected = [STARTER_TILE_SETS.work, STARTER_TILE_SETS.gaming, STARTER_TILE_SETS.chill];
  profiles.forEach((p, i) => {
    const want = expected[i]!;
    // The regression this guards: fresh installs used to get every tile type
    // (all 28) placed at once. Starter sets must stay a small curated subset.
    assert.ok(want.length <= 8, `starter set ${i} too large: ${want.length}`);
    assert.ok(want.length < ALL_TILE_TYPES.length);
    assert.deepEqual(p.landscape.tiles.map((t) => t.type), want);
    assert.deepEqual(p.portrait.tiles.map((t) => t.type), want);
  });
});

test('seedStarterProfiles: starter sets follow ALL_TILE_TYPES order', () => {
  for (const set of Object.values(STARTER_TILE_SETS)) {
    const indices = set.map((t) => ALL_TILE_TYPES.indexOf(t));
    assert.ok(indices.every((n) => n >= 0), 'unknown tile type in starter set');
    assert.deepEqual(indices, [...indices].sort((a, b) => a - b));
  }
});

test('seedStarterProfiles: tiles use the designed default rects', () => {
  const profiles = seedStarterProfiles();
  for (const p of profiles) {
    for (const t of p.landscape.tiles) {
      assert.deepEqual(t.rect, DEFAULT_LANDSCAPE_LAYOUT[t.type as keyof typeof DEFAULT_LANDSCAPE_LAYOUT]);
    }
    for (const t of p.portrait.tiles) {
      assert.deepEqual(t.rect, DEFAULT_PORTRAIT_LAYOUT[t.type as keyof typeof DEFAULT_PORTRAIT_LAYOUT]);
    }
  }
});

test('seedStarterProfiles: all instanceIds unique across profiles', () => {
  const profiles = seedStarterProfiles();
  const ids = profiles.flatMap((p) => [...p.landscape.tiles, ...p.portrait.tiles].map((t) => t.instanceId));
  assert.equal(new Set(ids).size, ids.length);
});
