import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SURFACE_THEMES, resolveSurfaceTheme } from './appTheme';

test('resolveSurfaceTheme falls back to default on garbage', () => {
  assert.equal(resolveSurfaceTheme('editorial'), 'editorial');
  assert.equal(resolveSurfaceTheme('frameless'), 'frameless');
  assert.equal(resolveSurfaceTheme('default'), 'default');
  assert.equal(resolveSurfaceTheme('paper'), 'default'); // not shipped yet
  assert.equal(resolveSurfaceTheme(42), 'default');
  assert.equal(resolveSurfaceTheme(null), 'default');
  assert.equal(resolveSurfaceTheme(undefined), 'default');
  assert.equal(resolveSurfaceTheme('__proto__'), 'default');
});

test('default theme stamps nothing — per-site fallbacks keep today\'s look', () => {
  assert.equal(SURFACE_THEMES.default.tokens, null);
});

test('every non-default theme defines the full token set', () => {
  for (const [id, def] of Object.entries(SURFACE_THEMES)) {
    if (!def.tokens) continue;
    for (const key of ['canvas', 'tile', 'overlay', 'chrome', 'hairline', 'tileRadius', 'tileBlur', 'tileShadow',
      'controlRadius', 'controlRadiusRound', 'controlBorder', 'controlBg'] as const) {
      assert.ok(def.tokens[key].length > 0, `${id}.${key}`);
    }
    assert.ok(def.label && def.hint, `${id} has label+hint`);
  }
});

test('only Editorial carries the serif display voice', () => {
  assert.match(SURFACE_THEMES.editorial.tokens!.displayFont ?? '', /serif/);
  assert.equal(SURFACE_THEMES.frameless.tokens!.displayFont, null);
});

test('each theme is a distinct material system, not a recolor', () => {
  const ed = SURFACE_THEMES.editorial.tokens!;
  const fr = SURFACE_THEMES.frameless.tokens!;
  // Editorial: print — flat, square-ish, unblurred, ruled.
  assert.equal(ed.tileShadow, 'none');
  assert.equal(ed.tileBlur, 'none');
  assert.ok(parseInt(ed.tileRadius) <= 4, 'print corners are near-square');
  assert.notEqual(ed.hairline, 'rgba(255,255,255,0)');
  // Frameless: air — no card material at all.
  assert.equal(fr.hairline, 'rgba(255,255,255,0)');
  assert.ok(/,0\)$/.test(fr.tile), 'tile surface fully transparent');
  assert.equal(fr.tileShadow, 'none');
  // ...and they disagree on corner language.
  assert.notEqual(ed.tileRadius, fr.tileRadius);
});

test('the control layer follows each system (0.9.9)', () => {
  const ed = SURFACE_THEMES.editorial.tokens!;
  const fr = SURFACE_THEMES.frameless.tokens!;
  // Print: squared controls — even the round ones — with visible warm rules.
  assert.ok(parseInt(ed.controlRadius) <= 3);
  assert.ok(parseInt(ed.controlRadiusRound) <= 3, 'switch knobs and slider thumbs go square in print');
  assert.notEqual(ed.controlBorder, 'rgba(255,255,255,0)');
  // Air: borderless, pills stay pills, fill carries the shape.
  assert.equal(fr.controlBorder, 'rgba(255,255,255,0)');
  assert.equal(fr.controlRadiusRound, '999px');
  assert.ok(fr.controlBg.length > 0);
  // ...and the two systems disagree on control corners too.
  assert.notEqual(ed.controlRadius, fr.controlRadius);
});
