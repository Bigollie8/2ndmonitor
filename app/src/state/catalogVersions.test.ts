import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVersionHistory, dateMapOf } from './catalogVersions';
import type { IndexBundle } from './catalog';

const bundle = (o: Partial<IndexBundle> = {}): IndexBundle => ({
  id: 'radar', version: '1.0.0', kind: 'tile', name: 'Radar', author: 'oli***',
  permissions: [], sha256: 'x', size: 1, downloads: 0, ...o,
});

test('buildVersionHistory: groups an id\'s rows, newest version first', () => {
  const h = buildVersionHistory([
    bundle({ version: '1.0.0', approvedAt: 100 }),
    bundle({ version: '1.2.0', approvedAt: 300 }),
    bundle({ version: '1.10.0', approvedAt: 400 }),
  ]);
  const radar = h.get('tile:radar')!;
  assert.deepEqual(radar.versions.map((v) => v.version), ['1.10.0', '1.2.0', '1.0.0'],
    '1.10 must beat 1.2 numerically, not as a string');
});

test('buildVersionHistory: publishedAt is the earliest approval, updatedAt the latest', () => {
  const h = buildVersionHistory([
    bundle({ version: '1.0.0', approvedAt: 100 }),
    bundle({ version: '2.0.0', approvedAt: 900 }),
  ]);
  const radar = h.get('tile:radar')!;
  assert.equal(radar.publishedAt, 100, 'first release');
  assert.equal(radar.updatedAt, 900, 'latest release');
});

test('buildVersionHistory: a single version has publishedAt === updatedAt', () => {
  const h = buildVersionHistory([bundle({ version: '1.0.0', approvedAt: 500 })]);
  const radar = h.get('tile:radar')!;
  assert.equal(radar.publishedAt, 500);
  assert.equal(radar.updatedAt, 500);
});

test('buildVersionHistory: rows with no approvedAt yield null dates, not zero', () => {
  // Bundles approved before the approved_at column existed. Zero would sort
  // as "the beginning of time", which is a claim; null is the truth.
  const h = buildVersionHistory([bundle({ version: '1.0.0' })]);
  const radar = h.get('tile:radar')!;
  assert.equal(radar.publishedAt, null);
  assert.equal(radar.updatedAt, null);
});

test('buildVersionHistory: a mix of dated and undated versions uses only the dated ones', () => {
  const h = buildVersionHistory([
    bundle({ version: '1.0.0' }),
    bundle({ version: '2.0.0', approvedAt: 700 }),
  ]);
  const radar = h.get('tile:radar')!;
  assert.equal(radar.publishedAt, 700);
  assert.equal(radar.updatedAt, 700);
});

test('buildVersionHistory: a tile and a visualizer sharing an id do not merge', () => {
  const h = buildVersionHistory([
    bundle({ id: 'shared', kind: 'tile', approvedAt: 1 }),
    bundle({ id: 'shared', kind: 'visualizer', approvedAt: 2 }),
  ]);
  assert.ok(h.has('tile:shared'));
  assert.ok(h.has('visualizer:shared'));
});

test('buildVersionHistory: changelog rides along per version', () => {
  const h = buildVersionHistory([
    bundle({ version: '1.1.0', changelog: 'Adds lightning.' }),
    bundle({ version: '1.0.0', changelog: 'Initial release.' }),
  ]);
  const radar = h.get('tile:radar')!;
  assert.equal(radar.versions[0].changelog, 'Adds lightning.');
  assert.equal(radar.versions[1].changelog, 'Initial release.');
});

test('dateMapOf produces exactly what sortItems consumes', () => {
  const h = buildVersionHistory([bundle({ approvedAt: 42 })]);
  const dates = dateMapOf(h);
  assert.deepEqual(dates.get('tile:radar'), { publishedAt: 42, updatedAt: 42 });
});
