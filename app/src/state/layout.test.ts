import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clampRectFrac,
  snapFrac,
  legacyRectToFraction,
  findEmptyRect,
  CHROME_TOP_PX,
  CHROME_BOTTOM_PX,
  MIN_SIZE_PX,
  SNAP_FRAC,
  DEFAULT_LANDSCAPE_LAYOUT,
  DEFAULT_PORTRAIT_LAYOUT,
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

import { decideOrientation } from './layout';

test('decideOrientation: tall viewport at first call → portrait', () => {
  assert.equal(decideOrientation({ w: 1080, h: 1920 }, undefined), 'portrait');
});

test('decideOrientation: wide viewport at first call → landscape', () => {
  assert.equal(decideOrientation({ w: 2560, h: 1440 }, undefined), 'landscape');
});

test('decideOrientation: hysteresis holds previous when aspect is between thresholds', () => {
  // aspect 1.0 — between 0.95 and 1.05, hold whatever was there before.
  const square = { w: 1000, h: 1000 };
  assert.equal(decideOrientation(square, 'portrait'), 'portrait');
  assert.equal(decideOrientation(square, 'landscape'), 'landscape');
});

test('decideOrientation: switches to portrait when aspect drops to ≤ 0.95', () => {
  const fromLand = decideOrientation({ w: 950, h: 1000 }, 'landscape');
  assert.equal(fromLand, 'portrait');
});

test('decideOrientation: switches to landscape when aspect rises to ≥ 1.05', () => {
  const fromPort = decideOrientation({ w: 1050, h: 1000 }, 'portrait');
  assert.equal(fromPort, 'landscape');
});

test('decideOrientation: does not switch on aspect 1.04 from portrait', () => {
  const r = decideOrientation({ w: 1040, h: 1000 }, 'portrait');
  assert.equal(r, 'portrait');
});

test('decideOrientation: does not switch on aspect 0.96 from landscape', () => {
  const r = decideOrientation({ w: 960, h: 1000 }, 'landscape');
  assert.equal(r, 'landscape');
});

const CANVAS = { w: 2560, h: 1440 };

test('findEmptyRect: empty visibleRects returns preferred unchanged', () => {
  const preferred = { x: 0.1, y: 0.2, w: 0.3, h: 0.3 };
  const out = findEmptyRect([], preferred, CANVAS);
  assert.deepEqual(out, preferred);
});

test('findEmptyRect: preferred non-overlapping returns preferred unchanged', () => {
  const preferred = { x: 0.6, y: 0.1, w: 0.2, h: 0.2 };
  const visible = [{ x: 0.0, y: 0.0, w: 0.3, h: 0.3 }];
  const out = findEmptyRect(visible, preferred, CANVAS);
  assert.deepEqual(out, preferred);
});

test('findEmptyRect: preferred overlaps → returns non-overlapping rect of same size', () => {
  const preferred = { x: 0.05, y: 0.1, w: 0.2, h: 0.2 };
  // A tile sits exactly where preferred wants to be:
  const visible = [{ x: 0.05, y: 0.1, w: 0.2, h: 0.2 }];
  const out = findEmptyRect(visible, preferred, CANVAS);
  // Same size:
  assert.equal(out.w, preferred.w);
  assert.equal(out.h, preferred.h);
  // Does not overlap the visible rect:
  const v = visible[0]!;
  const overlaps = out.x < v.x + v.w && out.x + out.w > v.x && out.y < v.y + v.h && out.y + out.h > v.y;
  assert.equal(overlaps, false, 'result should not overlap visible rect');
});

test('findEmptyRect: canvas full → returns preferred (overlap allowed as fallback)', () => {
  const preferred = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
  // One huge rect covering the entire content area:
  const visible = [{ x: 0, y: 0.04, w: 1, h: 0.93 }];
  const out = findEmptyRect(visible, preferred, CANVAS);
  // No empty space exists; helper returns preferred unchanged.
  assert.deepEqual(out, preferred);
});

test('DEFAULT_PORTRAIT_LAYOUT contains all 8 tiles', () => {
  const ids = Object.keys(DEFAULT_PORTRAIT_LAYOUT).sort();
  assert.deepEqual(ids, ['claude', 'clock', 'discord', 'mixer', 'notes', 'spotify', 'sysmon', 'viz']);
});

test('DEFAULT_PORTRAIT_LAYOUT: every rect lies within [0,1] and has positive size', () => {
  for (const [id, r] of Object.entries(DEFAULT_PORTRAIT_LAYOUT)) {
    assert.ok(r.x >= 0 && r.x + r.w <= 1, `${id} x out of bounds`);
    assert.ok(r.y >= 0 && r.y + r.h <= 1, `${id} y out of bounds`);
    assert.ok(r.w > 0 && r.h > 0, `${id} non-positive size`);
  }
});

test('DEFAULT_PORTRAIT_LAYOUT: tiles in the same row do not overlap', () => {
  const { discord, mixer } = DEFAULT_PORTRAIT_LAYOUT;
  assert.ok(discord.x + discord.w <= mixer.x + 1e-9, 'discord/mixer overlap horizontally');
  const { sysmon, clock } = DEFAULT_PORTRAIT_LAYOUT;
  assert.ok(sysmon.x + sysmon.w <= clock.x + 1e-9, 'sysmon/clock overlap horizontally');
});

test('DEFAULT_PORTRAIT_LAYOUT: bottom edges do not overlap bottom chrome on a 1920h canvas', () => {
  const CANVAS_H = 1920;
  const bottomReserved = CHROME_BOTTOM_PX / CANVAS_H;
  for (const [id, r] of Object.entries(DEFAULT_PORTRAIT_LAYOUT)) {
    assert.ok(
      r.y + r.h <= 1 - bottomReserved + 1e-6,
      `${id} bottom edge ${r.y + r.h} exceeds 1 - bottomReserved (${1 - bottomReserved}) on a 1920h canvas`,
    );
  }
});
