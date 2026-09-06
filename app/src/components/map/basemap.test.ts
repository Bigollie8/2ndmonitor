import test from 'node:test';
import assert from 'node:assert/strict';
import { BASEMAP_ATTRIBUTION, BASEMAP_MAX_Z, baseTileUrl } from './basemap';
import { MAX_TILE_Z } from './slippy';

// 0.9.18: CARTO's keyless dark_all endpoint began serving an "API KEY
// REQUIRED" watermark as a 200 image. These lock the replacement provider's
// URL grammar — ArcGIS is z/Y/X, the one slippy provider that puts the row
// before the column — and keep the visible credit tied to that provider.

test('baseTileUrl is keyless, https, and never CARTO', () => {
  const url = baseTileUrl(5, 16, 10);
  assert.ok(url.startsWith('https://'), url);
  assert.ok(!/cartocdn|carto\.com/i.test(url), 'CARTO now requires an API key');
  assert.ok(!/[?&](key|token|api_key|apikey|access_token)=/i.test(url), 'no key or token in the URL');
});

test('baseTileUrl puts the ROW (y) before the COLUMN (x) — ArcGIS tile order', () => {
  // z=5, x=16, y=10 → .../tile/5/10/16 — swapping these renders the wrong
  // part of the world, which is exactly the kind of bug a fixture catches.
  const url = baseTileUrl(5, 16, 10);
  assert.ok(url.endsWith('/tile/5/10/16'), url);
  assert.ok(!url.endsWith('/tile/5/16/10'), 'x/y must not be swapped back to CARTO order');
});

test('baseTileUrl targets the Esri World Dark Gray Base canvas', () => {
  assert.match(baseTileUrl(0, 0, 0), /services\.arcgisonline\.com\/ArcGIS\/rest\/services\/Canvas\/World_Dark_Gray_Base\/MapServer\/tile\/0\/0\/0$/);
});

test('attribution names the provider and its data sources', () => {
  // Esri's basemap terms: "Powered by Esri" plus the service copyrightText.
  assert.match(BASEMAP_ATTRIBUTION, /Powered by Esri/);
  assert.match(BASEMAP_ATTRIBUTION, /OpenStreetMap contributors/);
  assert.match(BASEMAP_ATTRIBUTION, /HERE/);
  assert.match(BASEMAP_ATTRIBUTION, /Garmin/);
  assert.ok(!/CARTO/.test(BASEMAP_ATTRIBUTION), 'the old credit must not linger');
});

test('slippy never requests a tile deeper than the provider serves', () => {
  // visibleTiles clamps the tile z to MAX_TILE_Z and scales past it; that
  // clamp has to sit at or below the provider's real data depth or maps
  // would ask for blank tiles at high zoom.
  assert.ok(MAX_TILE_Z <= BASEMAP_MAX_Z, `MAX_TILE_Z ${MAX_TILE_Z} > provider depth ${BASEMAP_MAX_Z}`);
});
