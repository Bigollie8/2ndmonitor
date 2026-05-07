import { test } from 'node:test';
import assert from 'node:assert/strict';

import { lonLatToTileXY } from './rainviewer';

test('lonLatToTileXY: z=0 returns the single world tile (0,0) for any input', () => {
  assert.deepEqual(lonLatToTileXY(0, 0, 0), { x: 0, y: 0 });
  assert.deepEqual(lonLatToTileXY(-180, 85, 0), { x: 0, y: 0 });
  assert.deepEqual(lonLatToTileXY(180, -85, 0), { x: 0, y: 0 });
});

test('lonLatToTileXY: z=1 places (-180, 85) in the top-left tile', () => {
  assert.deepEqual(lonLatToTileXY(-180, 85, 1), { x: 0, y: 0 });
});

test('lonLatToTileXY: z=1 places (90, -45) in the bottom-right region', () => {
  // At z=1 the world is divided into 2×2 tiles. lon=90 is in the right half (x=1).
  // lat=-45 is in the bottom half (y=1).
  assert.deepEqual(lonLatToTileXY(90, -45, 1), { x: 1, y: 1 });
});

test('lonLatToTileXY: Knoxville TN (-83.92, 35.96) at z=6 → (17, 25)', () => {
  // n = 1 << 6 = 64
  // x = floor((-83.92 + 180) / 360 * 64) = floor(17.08) = 17
  // y from standard slippy formula = 25
  assert.deepEqual(lonLatToTileXY(-83.92, 35.96, 6), { x: 17, y: 25 });
});
