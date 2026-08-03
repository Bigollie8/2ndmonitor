import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TILE_SIZE, MAX_LAT, clampZoom, clampLat, wrapLon,
  latLonToWorld, worldToLatLon,
  project, unproject, panBy, zoomAt, visibleTiles,
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

const VIEW = { center: { lat: 40, lon: -3 }, zoom: 6 };
const W = 400, H = 300;

test('project: the view center lands at the canvas center', () => {
  const p = project(VIEW, W, H, VIEW.center.lat, VIEW.center.lon);
  close(p.x, W / 2);
  close(p.y, H / 2);
});

test('unproject inverts project', () => {
  const p = project(VIEW, W, H, 48.8584, 2.2945);
  const back = unproject(VIEW, W, H, p.x, p.y);
  close(back.lat, 48.8584, 1e-9);
  close(back.lon, 2.2945, 1e-9);
});

test('project: takes the short way around the antimeridian', () => {
  const v = { center: { lat: 0, lon: 179.5 }, zoom: 4 };
  // -179.5 is 1° east of the center, not 359° west.
  const p = project(v, W, H, 0, -179.5);
  close(p.x, W / 2 + (1 / 360) * TILE_SIZE * Math.pow(2, 4), 1e-6);
});

test('panBy: dragging the map left (negative dx) moves the view east', () => {
  const next = panBy(VIEW, -10, 0);
  assert.ok(next.center.lon > VIEW.center.lon);
  assert.equal(next.zoom, VIEW.zoom);
});

test('panBy: a drag and its exact inverse return to the same center', () => {
  const there = panBy(VIEW, 37, -22);
  const back = panBy(there, -37, 22);
  close(back.center.lat, VIEW.center.lat, 1e-9);
  close(back.center.lon, VIEW.center.lon, 1e-9);
});

test('panBy: center latitude stays inside the Mercator limit', () => {
  const v = { center: { lat: 84, lon: 0 }, zoom: 2 };
  const next = panBy(v, 0, 100000);
  assert.ok(next.center.lat <= MAX_LAT && next.center.lat >= -MAX_LAT);
});

test('panBy: dragging the center across the antimeridian takes the short way', () => {
  // At z4, one tile-width (256px) of world-px covers 360/16 = 22.5° of lon.
  // Drag left (negative dx) by enough to push the center past +180 — it
  // should wrap to a small negative lon, not jump to a huge positive one.
  const v = { center: { lat: 0, lon: 179.9 }, zoom: 4 };
  const next = panBy(v, -20, 0);
  assert.ok(next.center.lon < 0, `expected wrapped negative lon, got ${next.center.lon}`);
  close(next.center.lon, -178.3421875, 1e-6);
});

test('zoomAt: the lat/lon under the cursor stays under the cursor', () => {
  const cursor = { x: 100, y: 80 };
  const anchor = unproject(VIEW, W, H, cursor.x, cursor.y);
  const zoomed = zoomAt(VIEW, 1, cursor, { w: W, h: H }, 4, 12);
  assert.equal(zoomed.zoom, 7);
  const p = project(zoomed, W, H, anchor.lat, anchor.lon);
  close(p.x, cursor.x, 1e-6);
  close(p.y, cursor.y, 1e-6);
});

test('zoomAt: clamps to maxZoom', () => {
  const zoomed = zoomAt(VIEW, 100, { x: 0, y: 0 }, { w: W, h: H }, 4, 12);
  assert.equal(zoomed.zoom, 12);
});

test('zoomAt: clamps to minZoom', () => {
  const zoomed = zoomAt(VIEW, -100, { x: 0, y: 0 }, { w: W, h: H }, 4, 12);
  assert.equal(zoomed.zoom, 4);
});

test('zoomAt: already at the clamp returns the view unchanged (same object)', () => {
  const v = { center: { lat: 40, lon: -3 }, zoom: 12 };
  assert.equal(zoomAt(v, 0.5, { x: 10, y: 10 }, { w: W, h: H }, 4, 12), v);
});

test('visibleTiles: 512×512 viewport at (0,0) z2 is exactly the middle 2×2 tiles', () => {
  const tiles = visibleTiles({ center: { lat: 0, lon: 0 }, zoom: 2 }, 512, 512);
  const key = (t: { x: number; y: number }) => `${t.x},${t.y}`;
  assert.deepEqual(tiles.map(key).sort(), ['1,1', '1,2', '2,1', '2,2']);
  for (const t of tiles) {
    assert.equal(t.z, 2);
    assert.equal(t.size, 256);
  }
  // The four tiles exactly cover the canvas: corners at 0 and 256.
  const t11 = tiles.find((t) => key(t) === '1,1')!;
  close(t11.sx, 0); close(t11.sy, 0);
  const t22 = tiles.find((t) => key(t) === '2,2')!;
  close(t22.sx, 256); close(t22.sy, 256);
});

test('visibleTiles: fractional zoom scales tiles from the nearest integer level', () => {
  const tiles = visibleTiles({ center: { lat: 0, lon: 0 }, zoom: 2.5 }, 256, 256);
  assert.ok(tiles.length > 0);
  for (const t of tiles) {
    assert.equal(t.z, 3); // round(2.5) = 3
    close(t.size, 256 / Math.SQRT2, 1e-9);
  }
});

test('visibleTiles: x wraps around the antimeridian, y is clipped at the poles', () => {
  const tiles = visibleTiles({ center: { lat: 0, lon: 179 }, zoom: 2 }, 512, 256);
  assert.ok(tiles.every((t) => t.x >= 0 && t.x <= 3 && t.y >= 0 && t.y <= 3));
  assert.ok(tiles.some((t) => t.x === 0), 'expected a wrapped tile from the far side');
});

test('visibleTiles: near-polar view never asks for out-of-range y tiles', () => {
  const tiles = visibleTiles({ center: { lat: 84, lon: 0 }, zoom: 2 }, 256, 1024);
  assert.ok(tiles.length > 0);
  assert.ok(tiles.every((t) => t.y >= 0 && t.y <= 3));
});
