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
    for (const key of ['canvas', 'tile', 'overlay', 'chrome', 'hairline'] as const) {
      assert.ok(def.tokens[key].length > 0, `${id}.${key}`);
    }
    assert.ok(def.label && def.hint, `${id} has label+hint`);
  }
});

test('only Editorial carries the serif display voice', () => {
  assert.match(SURFACE_THEMES.editorial.tokens!.displayFont ?? '', /serif/);
  assert.equal(SURFACE_THEMES.frameless.tokens!.displayFont, null);
});
