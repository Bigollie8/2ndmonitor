import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseMapView, serializeMapView, parseMapZoom, classifyViewChange } from './mapConfig';
import { MIN_TILE_Z, MAX_TILE_Z } from './slippy';

test('parseMapView: undefined / null / non-object returns null (no override)', () => {
  assert.equal(parseMapView(undefined), null);
  assert.equal(parseMapView(null), null);
  assert.equal(parseMapView(42), null);
  assert.equal(parseMapView('mapView'), null);
});

test('parseMapView: valid blob round-trips', () => {
  const blob = { center: { lat: 51.5074, lon: -0.1278 }, zoom: 8.5 };
  assert.deepEqual(parseMapView(blob), blob);
});

test('parseMapView: missing or non-finite fields return null', () => {
  assert.equal(parseMapView({ center: { lat: 1, lon: 2 } }), null);
  assert.equal(parseMapView({ zoom: 5 }), null);
  assert.equal(parseMapView({ center: { lat: NaN, lon: 2 }, zoom: 5 }), null);
  assert.equal(parseMapView({ center: { lat: '1', lon: 2 }, zoom: 5 }), null);
});

test('parseMapView: out-of-range coordinates return null', () => {
  assert.equal(parseMapView({ center: { lat: 91, lon: 0 }, zoom: 5 }), null);
  assert.equal(parseMapView({ center: { lat: 0, lon: 200 }, zoom: 5 }), null);
});

test('parseMapView: Infinity and -Infinity are rejected for lat, lon, and zoom', () => {
  assert.equal(parseMapView({ center: { lat: Infinity, lon: 0 }, zoom: 5 }), null);
  assert.equal(parseMapView({ center: { lat: -Infinity, lon: 0 }, zoom: 5 }), null);
  assert.equal(parseMapView({ center: { lat: 0, lon: Infinity }, zoom: 5 }), null);
  assert.equal(parseMapView({ center: { lat: 0, lon: -Infinity }, zoom: 5 }), null);
  assert.equal(parseMapView({ center: { lat: 0, lon: 0 }, zoom: Infinity }), null);
  assert.equal(parseMapView({ center: { lat: 0, lon: 0 }, zoom: -Infinity }), null);
});

test('parseMapView: zoom is clamped to valid range [MIN_TILE_Z, MAX_TILE_Z]', () => {
  assert.equal(parseMapView({ center: { lat: 0, lon: 0 }, zoom: 500 })?.zoom, MAX_TILE_Z);
  assert.equal(parseMapView({ center: { lat: 0, lon: 0 }, zoom: -50 })?.zoom, MIN_TILE_Z);
  assert.equal(parseMapView({ center: { lat: 0, lon: 0 }, zoom: 10 })?.zoom, 10);
});

test('serializeMapView survives a parse round-trip', () => {
  const view = { center: { lat: -33.8688, lon: 151.2093 }, zoom: 4 };
  assert.deepEqual(parseMapView(serializeMapView(view)), view);
});

// ── 0.8.2: zooming must not cancel anchor-following ──────────────────────────

test('parseMapZoom: rejects non-finite and non-numbers', () => {
  assert.equal(parseMapZoom(undefined), null);
  assert.equal(parseMapZoom(null), null);
  assert.equal(parseMapZoom('7'), null);
  assert.equal(parseMapZoom(NaN), null);
  assert.equal(parseMapZoom(Infinity), null);
});

test('parseMapZoom: clamps into the tile-zoom range', () => {
  assert.equal(parseMapZoom(7), 7);
  assert.equal(parseMapZoom(-5), 0);
  assert.equal(parseMapZoom(999), 19);
});

test('classifyViewChange: a zoom delta is a zoom, even when the centre also moved', () => {
  // This is the crux: zoomAt() anchors zoom at the CURSOR, so a wheel event
  // changes the centre too. Treating that centre shift as a pan is exactly
  // what used to cancel follow-mode on the first scroll.
  const prev = { center: { lat: 10, lon: 20 }, zoom: 7 };
  assert.equal(classifyViewChange(prev, { center: { lat: 11, lon: 21 }, zoom: 8 }), 'zoom');
  assert.equal(classifyViewChange(prev, { center: { lat: 10, lon: 20 }, zoom: 6.5 }), 'zoom');
});

test('classifyViewChange: centre-only movement is a pan', () => {
  const prev = { center: { lat: 10, lon: 20 }, zoom: 7 };
  assert.equal(classifyViewChange(prev, { center: { lat: 12, lon: 20 }, zoom: 7 }), 'pan');
});

test('classifyViewChange: float noise in zoom is not a zoom', () => {
  const prev = { center: { lat: 10, lon: 20 }, zoom: 7 };
  assert.equal(classifyViewChange(prev, { center: { lat: 12, lon: 20 }, zoom: 7 + 1e-12 }), 'pan');
});
