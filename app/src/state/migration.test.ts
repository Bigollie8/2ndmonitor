import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  migrateLegacyProfileToOrientations,
  DEFAULT_PORTRAIT_LAYOUT,
} from './layout';

test('migrate: legacy-shape profile gets fractions in landscape and portrait default', () => {
  const legacy = {
    id: 'p1', name: 'Work', color: '#a78bfa',
    layout: { spotify: { x: 20, y: 64, w: 560, h: 200 } },
    hidden: { mixer: true },
  };
  const out = migrateLegacyProfileToOrientations(legacy);
  assert.equal(out.id, 'p1');
  assert.equal(out.landscape.layout.spotify?.x, 20 / 2560);
  assert.equal(out.landscape.layout.spotify?.y, 64 / 1440);
  assert.equal(out.landscape.hidden.mixer, true);
  // Portrait inherits hidden but uses default portrait layout
  assert.deepEqual(out.portrait.layout, DEFAULT_PORTRAIT_LAYOUT);
  assert.equal(out.portrait.hidden.mixer, true);
});

test('migrate: empty legacy layout yields empty landscape layout (no defaults seeded)', () => {
  const legacy = {
    id: 'p2', name: 'Gaming', color: '#f59e0b',
    layout: {}, hidden: {},
  };
  const out = migrateLegacyProfileToOrientations(legacy);
  assert.deepEqual(out.landscape.layout, {});
  assert.deepEqual(out.landscape.hidden, {});
});

test('migrate: idempotent on already-migrated profile', () => {
  const already = {
    id: 'p3', name: 'Chill', color: '#22d3ee',
    landscape: { layout: { viz: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } }, hidden: {} },
    portrait: { layout: { ...DEFAULT_PORTRAIT_LAYOUT }, hidden: {} },
  };
  const out = migrateLegacyProfileToOrientations(already);
  assert.equal(out.landscape.layout.viz?.x, 0.1);
  assert.equal(out.landscape.layout.viz?.y, 0.1);
  assert.deepEqual(out.portrait.layout, DEFAULT_PORTRAIT_LAYOUT);
});
