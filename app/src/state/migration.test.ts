import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  migrateLegacyProfileToOrientations,
  DEFAULT_PORTRAIT_LAYOUT,
  ALL_TILE_TYPES,
} from './layout';

test('migrate: legacy-shape profile yields tiles arrays in both orientations', () => {
  const legacy = {
    id: 'p1', name: 'Work', color: '#a78bfa',
    layout: { spotify: { x: 20, y: 64, w: 560, h: 200 } },
    hidden: { mixer: true },
  };
  const out = migrateLegacyProfileToOrientations(legacy);
  assert.equal(out.id, 'p1');
  const landSpotify = out.landscape.tiles.find((t) => t.type === 'spotify');
  assert.equal(landSpotify?.rect.x, 20 / 2560);
  assert.equal(landSpotify?.rect.y, 64 / 1440);
  assert.equal(out.landscape.tiles.find((t) => t.type === 'mixer'), undefined);
  assert.equal(out.portrait.tiles.find((t) => t.type === 'mixer'), undefined);
  const portViz = out.portrait.tiles.find((t) => t.type === 'viz');
  assert.deepEqual(portViz?.rect, DEFAULT_PORTRAIT_LAYOUT.viz);
});

test('migrate: empty legacy layout yields full default tile lists', () => {
  const legacy = {
    id: 'p2', name: 'Gaming', color: '#f59e0b',
    layout: {}, hidden: {},
  };
  const out = migrateLegacyProfileToOrientations(legacy);
  assert.equal(out.landscape.tiles.length, ALL_TILE_TYPES.length);
  assert.equal(out.portrait.tiles.length, ALL_TILE_TYPES.length);
});

test('migrate: idempotent on already-migrated profile (both orientations have tiles)', () => {
  const fakeInstance = { instanceId: 'fixed-id', type: 'viz' as const, rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } };
  const already = {
    id: 'p3', name: 'Chill', color: '#22d3ee',
    landscape: { tiles: [fakeInstance] },
    portrait: { tiles: [fakeInstance] },
  };
  const out = migrateLegacyProfileToOrientations(already);
  assert.equal(out.landscape.tiles[0]?.instanceId, 'fixed-id');
  assert.equal(out.portrait.tiles[0]?.instanceId, 'fixed-id');
});

test('migrate: partial — landscape only — synthesises portrait tiles from defaults', () => {
  const fakeInstance = { instanceId: 'fixed-id', type: 'viz' as const, rect: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 } };
  const partial = {
    id: 'p4', name: 'Partial', color: '#ff0000',
    landscape: { tiles: [fakeInstance] },
  };
  const out = migrateLegacyProfileToOrientations(partial);
  assert.equal(out.landscape.tiles[0]?.instanceId, 'fixed-id');
  assert.equal(out.portrait.tiles.length, ALL_TILE_TYPES.length);
});
