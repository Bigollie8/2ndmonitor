import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseMapView, serializeMapView } from './mapConfig';

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

test('serializeMapView survives a parse round-trip', () => {
  const view = { center: { lat: -33.8688, lon: 151.2093 }, zoom: 4 };
  assert.deepEqual(parseMapView(serializeMapView(view)), view);
});
