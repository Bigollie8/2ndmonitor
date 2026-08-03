import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TILE_SIZE, MAX_LAT, clampZoom, clampLat, wrapLon,
  latLonToWorld, worldToLatLon,
} from './slippy';

const close = (a: number, b: number, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) < eps, `${a} !~= ${b} (eps ${eps})`);

test('latLonToWorld: (0,0) at zoom 0 is the center of the 256px world', () => {
  const p = latLonToWorld(0, 0, 0);
  close(p.x, 128);
  close(p.y, 128);
});

test('latLonToWorld: London at z10 lands in the well-known tile 511/340', () => {
  // https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames example region
  const p = latLonToWorld(51.5074, -0.1278, 10);
  assert.equal(Math.floor(p.x / TILE_SIZE), 511);
  assert.equal(Math.floor(p.y / TILE_SIZE), 340);
});

test('worldToLatLon inverts latLonToWorld across the globe', () => {
  const cases = [
    { lat: 0, lon: 0 }, { lat: 48.8584, lon: 2.2945 },
    { lat: -33.8688, lon: 151.2093 }, { lat: 64.13, lon: -21.9 },
    { lat: -54.8, lon: -68.3 },
  ];
  for (const c of cases) {
    const p = latLonToWorld(c.lat, c.lon, 5);
    const back = worldToLatLon(p.x, p.y, 5);
    close(back.lat, c.lat, 1e-9);
    close(back.lon, c.lon, 1e-9);
  }
});

test('latLonToWorld: latitude is clamped to the Mercator limit', () => {
  const pole = latLonToWorld(90, 0, 3);
  const limit = latLonToWorld(MAX_LAT, 0, 3);
  close(pole.y, limit.y, 1e-9);
  assert.ok(pole.y >= 0);
});

test('wrapLon wraps into [-180, 180)', () => {
  assert.equal(wrapLon(0), 0);
  assert.equal(wrapLon(190), -170);
  assert.equal(wrapLon(-190), 170);
  assert.equal(wrapLon(180), -180);
  assert.equal(wrapLon(360), 0);
});

test('clampZoom clamps and maps non-finite input to the minimum', () => {
  assert.equal(clampZoom(5, 3, 10), 5);
  assert.equal(clampZoom(0, 3, 10), 3);
  assert.equal(clampZoom(99, 3, 10), 10);
  assert.equal(clampZoom(NaN, 3, 10), 3);
});

test('clampLat clamps to the Web-Mercator latitude limit', () => {
  assert.equal(clampLat(89), MAX_LAT);
  assert.equal(clampLat(-89), -MAX_LAT);
  assert.equal(clampLat(12.5), 12.5);
});
