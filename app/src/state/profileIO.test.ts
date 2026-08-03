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
});
