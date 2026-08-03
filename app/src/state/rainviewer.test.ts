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

// ── Radar loop controls (0.7.2 §1) ──────────────────────────────────────────
import { parseRadarConfig, radarFrameSlice, RADAR_SPEED_MS } from './rainviewer';

test('parseRadarConfig: defaults on garbage or absence', () => {
  const fallback = { windowMin: 60, speed: 'normal' };
  assert.deepEqual(parseRadarConfig(undefined), fallback);
  assert.deepEqual(parseRadarConfig(null), fallback);
  assert.deepEqual(parseRadarConfig('fast'), fallback);
  assert.deepEqual(parseRadarConfig({ windowMin: 45, speed: 'ludicrous' }), fallback);
});

test('parseRadarConfig: valid values pass, fields fall back independently', () => {
  assert.deepEqual(parseRadarConfig({ windowMin: 30, speed: 'fast' }), { windowMin: 30, speed: 'fast' });
  assert.deepEqual(parseRadarConfig({ windowMin: 120 }), { windowMin: 120, speed: 'normal' });
  assert.deepEqual(parseRadarConfig({ speed: 'slow' }), { windowMin: 60, speed: 'slow' });
});

test('parseRadarConfig: tolerates the shared map-view keys in the same blob', () => {
  assert.deepEqual(
    parseRadarConfig({ mapView: { lat: 1, lon: 2, zoom: 7 }, windowMin: 120, speed: 'slow' }),
    { windowMin: 120, speed: 'slow' },
  );
});

test('radarFrameSlice: windowMin/10 + 1 frames off the tail', () => {
  const past = Array.from({ length: 13 }, (_, i) => i); // full RainViewer manifest
  assert.deepEqual(radarFrameSlice(past, 30), [9, 10, 11, 12]);           // 4 frames
  assert.equal(radarFrameSlice(past, 60).length, 7);                      // last hour
  assert.deepEqual(radarFrameSlice(past, 120), past);                     // everything the API has
  assert.deepEqual(radarFrameSlice([1, 2, 3], 120), [1, 2, 3]);           // short manifest survives
  assert.deepEqual(radarFrameSlice([], 30), []);
});

test('RADAR_SPEED_MS: slow/normal/fast cadence', () => {
  assert.deepEqual(RADAR_SPEED_MS, { slow: 1200, normal: 800, fast: 500 });
});
