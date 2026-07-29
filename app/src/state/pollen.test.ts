import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  bucketFromGrains,
  buildPollenSample,
  type GooglePollenResult,
  type OpenMeteoCurrent,
} from './pollen';

// ─── bucketFromGrains ────────────────────────────────────────────────────────
// Thresholds: <1 → 0, <10 → 1, <50 → 2, <100 → 3, <200 → 4, else 5.

test('bucketFromGrains: null passes through as null', () => {
  assert.equal(bucketFromGrains(null), null);
});

test('bucketFromGrains: bucket boundaries', () => {
  // [input, expected bucket]
  const cases: [number, number][] = [
    [0, 0],
    [0.99, 0],
    [1, 1],     // lower edge of "very low"
    [9.99, 1],
    [10, 2],    // lower edge of "low"
    [49.99, 2],
    [50, 3],    // lower edge of "moderate"
    [99.99, 3],
    [100, 4],   // lower edge of "high"
    [199.99, 4],
    [200, 5],   // lower edge of "very high"
    [10000, 5],
  ];
  for (const [grains, expected] of cases) {
    assert.equal(bucketFromGrains(grains), expected,
      `bucketFromGrains(${grains}) should be ${expected}`);
  }
});

// ─── buildPollenSample (Google-vs-Open-Meteo merge decision) ────────────────
// The fetching itself (fetchPollenSample / fetchOpenMeteo / fetchGooglePollen)
// is network-bound and not tested here; the pure merge decision was extracted
// into buildPollenSample.

function googleResult(overrides: Partial<GooglePollenResult> = {}): GooglePollenResult {
  return {
    grass: 2,
    tree: 4,
    weed: 0,
    grassInSeason: true,
    treeInSeason: true,
    weedInSeason: false,
    topPlants: [{ name: 'Oak', index: 4 }, { name: 'Graminales', index: 2 }],
    healthRecommendations: ['Limit outdoor time in the early morning.'],
    ...overrides,
  };
}

test('buildPollenSample: Google result wins, Open-Meteo still supplies PM2.5/AQI', () => {
  const meteo: OpenMeteoCurrent = { us_aqi: 42, pm2_5: 8.3 };
  const s = buildPollenSample(googleResult(), meteo);
  assert.ok(s);
  assert.equal(s.source, 'google');
  assert.equal(s.grass, 2);
  assert.equal(s.tree, 4);
  assert.equal(s.weed, 0);
  assert.equal(s.grassInSeason, true);
  assert.equal(s.weedInSeason, false);
  assert.deepEqual(s.topPlants.map((p) => p.name), ['Oak', 'Graminales']);
  assert.equal(s.healthRecommendations.length, 1);
  // PM2.5 / AQI always come from Open-Meteo, even on the Google path.
  assert.equal(s.pm25, 8.3);
  assert.equal(s.usAqi, 42);
});

test('buildPollenSample: Google result with Open-Meteo down → pollen kept, pm25/aqi null', () => {
  const s = buildPollenSample(googleResult(), null);
  assert.ok(s);
  assert.equal(s.source, 'google');
  assert.equal(s.pm25, null);
  assert.equal(s.usAqi, null);
});

test('buildPollenSample: no Google → Open-Meteo fallback buckets grains onto 0..5', () => {
  const meteo: OpenMeteoCurrent = {
    us_aqi: 55,
    pm2_5: 14.2,
    grass_pollen: 12,      // → bucket 2
    birch_pollen: 120,     // tree = max(120, 3, 0) = 120 → bucket 4
    olive_pollen: 3,
    alder_pollen: 0,
    ragweed_pollen: 0.5,   // weed = max(0.5, 0) = 0.5 → bucket 0
    mugwort_pollen: 0,
  };
  const s = buildPollenSample(null, meteo);
  assert.ok(s);
  assert.equal(s.source, 'open-meteo');
  assert.equal(s.grass, 2);
  assert.equal(s.tree, 4);
  assert.equal(s.weed, 0);
  // Open-Meteo doesn't report seasonality.
  assert.equal(s.grassInSeason, null);
  assert.equal(s.treeInSeason, null);
  assert.equal(s.weedInSeason, null);
  assert.deepEqual(s.topPlants, []);
  assert.deepEqual(s.healthRecommendations, []);
  assert.equal(s.pm25, 14.2);
  assert.equal(s.usAqi, 55);
});

test('buildPollenSample: Open-Meteo outside EU coverage → null pollen indices, pm25 kept', () => {
  // Non-EU locations: CAMS pollen fields all absent.
  const meteo: OpenMeteoCurrent = { us_aqi: 31, pm2_5: 5.1 };
  const s = buildPollenSample(null, meteo);
  assert.ok(s);
  assert.equal(s.source, 'open-meteo');
  assert.equal(s.grass, null);
  assert.equal(s.tree, null);
  assert.equal(s.weed, null);
  assert.equal(s.pm25, 5.1);
  assert.equal(s.usAqi, 31);
});

test('buildPollenSample: partial tree data still counts as data (not null)', () => {
  // Only one of the three tree species reported: tree should be bucketed,
  // not treated as unavailable.
  const meteo: OpenMeteoCurrent = { pm2_5: 3, olive_pollen: 60 };
  const s = buildPollenSample(null, meteo);
  assert.ok(s);
  assert.equal(s.tree, 3);   // 60 grains → moderate
  assert.equal(s.weed, null); // both weed species absent → null
});

test('buildPollenSample: neither source has data → null', () => {
  assert.equal(buildPollenSample(null, null), null);
});
