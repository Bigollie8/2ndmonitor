import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Profile } from '../types';
import {
  buildProfileExport, exportFileName, parseProfileExport,
  PROFILE_EXPORT_KIND, PROFILE_EXPORT_VERSION,
} from './profileIO';

const FIXTURE: Profile = {
  id: 'prof-1', name: 'Work', color: '#a78bfa',
  landscape: {
    tiles: [
      { instanceId: 'a1', type: 'viz', rect: { x: 0.23, y: 0.05, w: 0.75, h: 0.65 } },
      {
        instanceId: 'a2', type: 'weatherRadar', rect: { x: 0.42, y: 0.05, w: 0.30, h: 0.30 },
        config: { mapView: { center: { lat: 35.96, lon: -83.92 }, zoom: 8 }, layers: ['rain'] },
      },
      { instanceId: 'a3', type: 'bundle:tile-birds', rect: { x: 0.05, y: 0.05, w: 0.20, h: 0.18 } },
    ],
  },
  portrait: {
    tiles: [
      {
        instanceId: 'b1', type: 'iss', rect: { x: 0.05, y: 0.30, w: 0.90, h: 0.18 },
        config: { mapView: { center: { lat: 1, lon: 2 }, zoom: 3 } },
      },
    ],
  },
};

test('buildProfileExport: shape, kind, version', () => {
  const out = buildProfileExport(FIXTURE);
  assert.equal(out.kind, PROFILE_EXPORT_KIND);
  assert.equal(out.version, PROFILE_EXPORT_VERSION);
  assert.equal(out.name, 'Work');
  assert.equal(out.color, '#a78bfa');
  assert.equal(out.landscape.tiles.length, 3);
  assert.equal(out.portrait.tiles.length, 1);
});

test('buildProfileExport: strips mapView from every tile, keeps other config', () => {
  const out = buildProfileExport(FIXTURE);
  const radar = out.landscape.tiles[1]!;
  assert.deepEqual(radar.config, { layers: ['rain'] });
  // portrait tile's config was ONLY mapView → config key omitted entirely
  assert.equal(out.portrait.tiles[0]!.config, undefined);
  // and the source profile was not mutated
  assert.ok(FIXTURE.landscape.tiles[1]!.config!.mapView);
});

test('roundtrip: parse(build(p)) is ok, ids regenerated, unknown types pass through', () => {
  const raw = JSON.parse(JSON.stringify(buildProfileExport(FIXTURE)));
  const result = parseProfileExport(raw);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const p = result.profile;
  assert.equal(p.name, 'Work');
  assert.equal(p.landscape.tiles.length, 3);
  // instanceIds regenerated — never the exported ones
  const ids = [...p.landscape.tiles, ...p.portrait.tiles].map((t) => t.instanceId);
  for (const id of ids) assert.ok(!['a1', 'a2', 'a3', 'b1'].includes(id));
  assert.equal(new Set(ids).size, ids.length);
  // unknown/bundle type passes through untouched (MissingTileCard handles it at render)
  assert.equal(p.landscape.tiles[2]!.type, 'bundle:tile-birds');
});

test('parseProfileExport: rejects non-profile junk', () => {
  for (const bad of [null, 42, 'hi', [], {}, { kind: 'settings' }, { kind: PROFILE_EXPORT_KIND, version: 2, name: 'x', color: '#fff', landscape: { tiles: [] }, portrait: { tiles: [] } }]) {
    const r = parseProfileExport(bad);
    assert.equal(r.ok, false, `should reject ${JSON.stringify(bad)}`);
  }
});

test('parseProfileExport: malicious/corrupt file → error, not a throw', () => {
  const evil = {
    kind: PROFILE_EXPORT_KIND, version: PROFILE_EXPORT_VERSION,
    name: 'x', color: 'javascript:alert(1)',
    landscape: { tiles: [{ instanceId: 7, type: 'viz', rect: { x: 'NaN', y: 0, w: 1, h: 1 } }] },
    portrait: { tiles: 'not-an-array' },
  };
  const r = parseProfileExport(evil);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(typeof r.error, 'string');
});

test('parseProfileExport: clamps out-of-range rects via clampRectFrac', () => {
  const raw = {
    kind: PROFILE_EXPORT_KIND, version: PROFILE_EXPORT_VERSION,
    name: 'Huge', color: '#22c55e',
    landscape: { tiles: [{ instanceId: 'z', type: 'notes', rect: { x: -3, y: -3, w: 9, h: 9 } }] },
    portrait: { tiles: [] },
  };
  const r = parseProfileExport(raw);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const rect = r.profile.landscape.tiles[0]!.rect;
  assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= 1 && rect.y + rect.h <= 1.0001);
});

test('parseProfileExport: strips mapView defensively on import', () => {
  const raw = {
    kind: PROFILE_EXPORT_KIND, version: PROFILE_EXPORT_VERSION,
    name: 'Sneaky', color: '#22c55e',
    landscape: { tiles: [{ instanceId: 'z', type: 'iss', rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, config: { mapView: { center: { lat: 1, lon: 2 }, zoom: 3 }, other: 1 } }] },
    portrait: { tiles: [] },
  };
  const r = parseProfileExport(raw);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.profile.landscape.tiles[0]!.config, { other: 1 });
});

test('parseProfileExport: caps tile count per orientation to guard against a crafted mega-file', () => {
  const makeTile = (i: number) => ({ instanceId: `t${i}`, type: 'notes', rect: { x: 0, y: 0, w: 0.1, h: 0.1 } });
  const okBase = {
    kind: PROFILE_EXPORT_KIND, version: PROFILE_EXPORT_VERSION,
    name: 'Many', color: '#22c55e', portrait: { tiles: [] },
  };
  const atCap = parseProfileExport({ ...okBase, landscape: { tiles: Array.from({ length: 200 }, (_, i) => makeTile(i)) } });
  assert.equal(atCap.ok, true);
  const overCap = parseProfileExport({ ...okBase, landscape: { tiles: Array.from({ length: 201 }, (_, i) => makeTile(i)) } });
  assert.equal(overCap.ok, false);
  if (!overCap.ok) assert.equal(typeof overCap.error, 'string');
});

test('parseProfileExport: filters __proto__/constructor/prototype keys out of config', () => {
  const raw = {
    kind: PROFILE_EXPORT_KIND, version: PROFILE_EXPORT_VERSION,
    name: 'Proto', color: '#22c55e',
    landscape: {
      tiles: [{
        instanceId: 'z', type: 'iss', rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
        config: { ['__proto__']: { polluted: true }, keep: 1 },
      }],
    },
    portrait: { tiles: [] },
  };
  const r = parseProfileExport(raw);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const config = r.profile.landscape.tiles[0]!.config;
  assert.deepEqual(config, { keep: 1 });
  assert.ok(!Object.prototype.hasOwnProperty.call(config, '__proto__'));
});

test('parseProfileExport: bad color falls back, bad name rejects', () => {
  const base = { kind: PROFILE_EXPORT_KIND, version: PROFILE_EXPORT_VERSION, landscape: { tiles: [] }, portrait: { tiles: [] } };
  const r1 = parseProfileExport({ ...base, name: 'Ok', color: 'red' });
  assert.equal(r1.ok, true);
  if (r1.ok) assert.match(r1.profile.color, /^#[0-9a-fA-F]{6}$/);
  assert.equal(parseProfileExport({ ...base, name: '', color: '#ffffff' }).ok, false);
  assert.equal(parseProfileExport({ ...base, name: 42, color: '#ffffff' }).ok, false);
});

test('exportFileName: sanitizes and appends the profile extension', () => {
  assert.equal(exportFileName('Work'), 'Work.2ndmonitor-profile.json');
  assert.equal(exportFileName('a/b\\c:d*e?f"g<h>i|j'), 'abcdefghij.2ndmonitor-profile.json');
  assert.equal(exportFileName('   '), 'profile.2ndmonitor-profile.json');
  // ASCII control characters (e.g. embedded NUL / unit separator) are stripped too
  assert.equal(exportFileName('Wo\x00rk\x1f!'), 'Work!.2ndmonitor-profile.json');
});

// ── Setup export/import (0.9.8) ─────────────────────────────────────────────

import {
  buildSetupExport, parseSetupExport, mergeSetupTiles, setupExportFileName,
  SETUP_EXPORT_KIND, SETUP_EXPORT_VERSION,
} from './profileIO';

test('setup round-trip: build → parse preserves tiles, strips mapView + proto keys, fresh ids', () => {
  const built = buildSetupExport('My corner', 'landscape', FIXTURE.landscape.tiles);
  assert.equal(built.kind, SETUP_EXPORT_KIND);
  assert.equal(built.version, SETUP_EXPORT_VERSION);
  assert.equal(built.orientation, 'landscape');
  const radar = built.tiles.find((t) => t.type === 'weatherRadar')!;
  assert.ok(!('mapView' in (radar.config ?? {})), 'mapView stripped on export');
  assert.deepEqual(radar.config, { layers: ['rain'] });

  const roundTripped = JSON.parse(JSON.stringify(built));
  // sneak dangerous keys in — they must not survive the parse
  roundTripped.tiles[0].config = { ['__proto__']: { polluted: true }, mapView: { center: {} }, keep: 1 };
  const parsed = parseSetupExport(roundTripped);
  assert.ok(parsed.ok);
  assert.equal(parsed.setup.name, 'My corner');
  assert.equal(parsed.setup.tiles.length, 3);
  assert.deepEqual(parsed.setup.tiles[0].config, { keep: 1 });
  const originalIds = new Set(FIXTURE.landscape.tiles.map((t) => t.instanceId));
  for (const t of parsed.setup.tiles) assert.ok(!originalIds.has(t.instanceId), 'fresh instanceIds');
});

test('setup files and profile files are never confused', () => {
  const setup = JSON.parse(JSON.stringify(buildSetupExport('s', 'portrait', FIXTURE.portrait.tiles)));
  assert.equal(parseProfileExport(setup).ok, false);
  const profile = JSON.parse(JSON.stringify(buildProfileExport(FIXTURE)));
  assert.equal(parseSetupExport(profile).ok, false);
});

test('parseSetupExport rejects malformed input', () => {
  assert.equal(parseSetupExport(null).ok, false);
  assert.equal(parseSetupExport([]).ok, false);
  assert.equal(parseSetupExport({ kind: SETUP_EXPORT_KIND, version: 99, orientation: 'landscape', tiles: [] }).ok, false);
  assert.equal(parseSetupExport({ kind: SETUP_EXPORT_KIND, version: 1, orientation: 'diagonal', tiles: [] }).ok, false);
  assert.equal(parseSetupExport({ kind: SETUP_EXPORT_KIND, version: 1, orientation: 'landscape', tiles: [] }).ok, false, 'empty tile list rejected');
  assert.equal(parseSetupExport({ kind: SETUP_EXPORT_KIND, version: 1, orientation: 'landscape', tiles: [{ type: 'viz' }] }).ok, false, 'tile without rect rejected');
});

test('setup rects are clamped like profile rects', () => {
  const parsed = parseSetupExport({
    kind: SETUP_EXPORT_KIND, version: 1, orientation: 'landscape',
    tiles: [{ instanceId: 'x', type: 'viz', rect: { x: 5, y: -3, w: 99, h: 99 } }],
  });
  assert.ok(parsed.ok);
  const r = parsed.setup.tiles[0].rect;
  assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 1.0001 && r.y + r.h <= 1.0001);
});

test('mergeSetupTiles is additive and honors the tile cap', () => {
  const existing = FIXTURE.landscape.tiles;
  const incoming = [{ instanceId: 'n1', type: 'clock', rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }] as typeof existing;
  const { tiles, dropped } = mergeSetupTiles(existing, incoming);
  assert.equal(tiles.length, 4);
  assert.equal(dropped, 0);
  assert.deepEqual(tiles.slice(0, 3), existing, 'existing untouched, order preserved');

  const big = Array.from({ length: 300 }, (_, i) => ({ instanceId: `b${i}`, type: 'clock', rect: { x: 0, y: 0, w: 0.1, h: 0.1 } })) as typeof existing;
  const capped = mergeSetupTiles(existing, big);
  assert.equal(capped.tiles.length, 200);
  assert.equal(capped.dropped, 300 - (200 - existing.length));
});

test('setupExportFileName strips forbidden characters', () => {
  assert.equal(setupExportFileName('My: cool/setup?'), 'My coolsetup.2ndmonitor-setup.json');
  assert.equal(setupExportFileName('   '), 'setup.2ndmonitor-setup.json');
});
