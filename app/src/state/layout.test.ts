import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clampRectFrac,
  snapFrac,
  legacyRectToFraction,
  CHROME_TOP_PX,
  CHROME_BOTTOM_PX,
  MIN_SIZE_PX,
  SNAP_FRAC,
} from './layout';

const LANDSCAPE = { w: 2560, h: 1440 };
const PORTRAIT = { w: 1080, h: 1920 };

test('legacyRectToFraction: 2560x1440 rect at origin maps to fractions in [0,1]', () => {
  const f = legacyRectToFraction({ x: 0, y: 0, w: 2560, h: 1440 });
  assert.deepEqual(f, { x: 0, y: 0, w: 1, h: 1 });
});

test('legacyRectToFraction: rail rect maps proportionally', () => {
  const f = legacyRectToFraction({ x: 20, y: 64, w: 560, h: 1336 });
  assert.equal(f.x, 20 / 2560);
  assert.equal(f.y, 64 / 1440);
  assert.equal(f.w, 560 / 2560);
  assert.equal(f.h, 1336 / 1440);
});

test('clampRectFrac: keeps rect inside [0,1] minus chrome on landscape', () => {
  const oversize = { x: -0.5, y: -0.5, w: 2, h: 2 };
  const c = clampRectFrac(oversize, LANDSCAPE);
  assert.equal(c.x, 0);
  assert.equal(c.y, CHROME_TOP_PX / LANDSCAPE.h);
  assert.equal(c.w, 1 - c.x);
  assert.equal(c.h, 1 - CHROME_BOTTOM_PX / LANDSCAPE.h - c.y);
});

test('clampRectFrac: enforces pixel-based min size on portrait', () => {
  const tiny = { x: 0.5, y: 0.5, w: 0.001, h: 0.001 };
  const c = clampRectFrac(tiny, PORTRAIT);
  assert.equal(c.w, MIN_SIZE_PX.w / PORTRAIT.w);
  assert.equal(c.h, MIN_SIZE_PX.h / PORTRAIT.h);
});

test('clampRectFrac: respects top chrome reserved area', () => {
  const tooHigh = { x: 0.1, y: 0.0, w: 0.2, h: 0.3 };
  const c = clampRectFrac(tooHigh, LANDSCAPE);
  assert.equal(c.y, CHROME_TOP_PX / LANDSCAPE.h);
});

test('clampRectFrac: respects bottom chrome reserved area', () => {
  const tooLow = { x: 0.1, y: 0.95, w: 0.2, h: 0.3 };
  const c = clampRectFrac(tooLow, LANDSCAPE);
  // Bottom-edge of clamped rect must not pass 1 - bottom-chrome-fraction.
  const bottomFrac = CHROME_BOTTOM_PX / LANDSCAPE.h;
  assert.ok(c.y + c.h <= 1 - bottomFrac + 1e-9);
});

test('snapFrac: round-trips a value already on the grid', () => {
  const v = SNAP_FRAC * 5;
  assert.equal(snapFrac(v), v);
});

test('snapFrac: rounds to nearest increment', () => {
  const off = SNAP_FRAC * 5 + SNAP_FRAC * 0.4;
  assert.equal(snapFrac(off), SNAP_FRAC * 5);
  const off2 = SNAP_FRAC * 5 + SNAP_FRAC * 0.6;
  assert.equal(snapFrac(off2), SNAP_FRAC * 6);
});
