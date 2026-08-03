import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeSurfaces, glassTintAlpha, DEFAULT_GLASS_STRENGTH } from './theme';

test('glass off returns null regardless of strength', () => {
  assert.equal(computeSurfaces(false, 0), null);
  assert.equal(computeSurfaces(false, 60), null);
  assert.equal(computeSurfaces(false, 100), null);
});

test('default strength 60 hits the spec alphas (~0.35 canvas, ~0.5 tile)', () => {
  assert.deepEqual(computeSurfaces(true, 60), {
    canvas: 'rgba(6,7,10,0.35)',
    tile: 'rgba(22,24,30,0.5)',
    overlay: 'rgba(20,22,28,0.76)',
    chrome: 'rgba(8,9,12,0.57)',
  });
});

test('strength 0 is clearest, strength 100 is most opaque frosted', () => {
  assert.deepEqual(computeSurfaces(true, 0), {
    canvas: 'rgba(6,7,10,0.05)',
    tile: 'rgba(22,24,30,0.14)',
    overlay: 'rgba(20,22,28,0.55)',
    chrome: 'rgba(8,9,12,0.3)',
  });
  assert.deepEqual(computeSurfaces(true, 100), {
    canvas: 'rgba(6,7,10,0.55)',
    tile: 'rgba(22,24,30,0.74)',
    overlay: 'rgba(20,22,28,0.9)',
    chrome: 'rgba(8,9,12,0.75)',
  });
});

test('strength clamps to [0,100] and non-finite falls back to the default', () => {
  assert.deepEqual(computeSurfaces(true, -20), computeSurfaces(true, 0));
  assert.deepEqual(computeSurfaces(true, 250), computeSurfaces(true, 100));
  assert.deepEqual(computeSurfaces(true, Number.NaN), computeSurfaces(true, DEFAULT_GLASS_STRENGTH));
});

test('glassTintAlpha: 0 at strength 0 (acrylic cleared), scales with strength', () => {
  assert.equal(glassTintAlpha(0), 0);
  assert.equal(glassTintAlpha(60), 0.33);
  assert.equal(glassTintAlpha(100), 0.55);
  assert.equal(glassTintAlpha(Number.NaN), 0.33);
});
