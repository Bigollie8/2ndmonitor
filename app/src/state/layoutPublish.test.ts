import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toPublishedLayout, layoutDependencies, isPublishedLayout,
  type PublishSource,
} from './layoutPublish';
import type { TileInstance, TileType } from './layout';

const tile = (o: Partial<TileInstance> = {}): TileInstance => ({
  instanceId: 'inst-1',
  type: 'clock' as TileType,
  rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
  ...o,
});

const src = (o: Partial<PublishSource> = {}): PublishSource => ({
  landscape: [tile()],
  portrait: [],
  accent: '#7cf5d4',
  accent2: '#a5b4fc',
  density: 'comfortable',
  glass: true,
  vizMode: 'aurora',
  ...o,
});

test('a published layout carries type and rect', () => {
  const out = toPublishedLayout(src());
  assert.equal(out.v, 1);
  assert.equal(out.landscape.length, 1);
  assert.equal(out.landscape[0].type, 'clock');
  assert.deepEqual(out.landscape[0].rect, { x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
});

// THE test. Publishing config would put home coordinates, usernames and
// tickers on a public marketplace.
test('tile config is never published', () => {
  const out = toPublishedLayout(src({
    landscape: [tile({ config: { lat: 47.62, lon: -122.35, user: 'oliver' } })],
  }));
  const json = JSON.stringify(out);
  assert.equal('config' in out.landscape[0], false);
  assert.ok(!json.includes('47.62'), 'coordinates must not appear anywhere');
  assert.ok(!json.includes('oliver'), 'usernames must not appear anywhere');
});

test('instanceId and name are not published either', () => {
  const out = toPublishedLayout(src({
    landscape: [tile({ instanceId: 'private-uuid', name: 'My personal radar' })],
  }));
  const json = JSON.stringify(out);
  assert.ok(!json.includes('private-uuid'));
  assert.ok(!json.includes('My personal radar'));
});

// The property that actually keeps this safe over time: a field nobody has
// thought about yet is excluded because it was never named, not because
// someone remembered to exclude it.
test('a field added to TileInstance later is not published', () => {
  const future = { ...tile(), homeAddress: '10 Downing Street', apiToken: 'sk-live-123' };
  const out = toPublishedLayout(src({ landscape: [future as unknown as TileInstance] }));
  const json = JSON.stringify(out);
  assert.ok(!json.includes('Downing'), 'an unknown field must not ride along');
  assert.ok(!json.includes('sk-live'), 'an unknown field must not ride along');
  assert.deepEqual(Object.keys(out.landscape[0]).sort(), ['rect', 'type']);
});

test('the theme is a closed set of scalars', () => {
  const out = toPublishedLayout(src());
  assert.deepEqual(
    Object.keys(out.theme).sort(),
    ['accent', 'accent2', 'density', 'glass', 'vizMode'],
  );
});

test('rects are rounded, so two identical layouts serialise identically', () => {
  const out = toPublishedLayout(src({
    landscape: [tile({ rect: { x: 0.123456789, y: 0, w: 0.5, h: 0.5 } })],
  }));
  assert.equal(out.landscape[0].rect.x, 0.1235);
});

// A rect outside the unit square renders off-screen on the installer's
// machine even though it looked fine on the author's.
test('rects are clamped into the unit square', () => {
  const out = toPublishedLayout(src({
    landscape: [tile({ rect: { x: -0.5, y: 2, w: 1.5, h: 0.5 } })],
  }));
  assert.deepEqual(out.landscape[0].rect, { x: 0, y: 1, w: 1, h: 0.5 });
});

test('both orientations are published', () => {
  const out = toPublishedLayout(src({
    landscape: [tile()],
    portrait: [tile({ type: 'weather' as TileType })],
  }));
  assert.equal(out.landscape.length, 1);
  assert.equal(out.portrait.length, 1);
  assert.equal(out.portrait[0].type, 'weather');
});

test('dependencies list only marketplace bundles, deduplicated and sorted', () => {
  const out = toPublishedLayout(src({
    landscape: [
      tile({ type: 'bundle:tile-quote' as TileType }),
      tile({ type: 'clock' as TileType }),
      tile({ type: 'bundle:tile-birds' as TileType }),
    ],
    portrait: [tile({ type: 'bundle:tile-quote' as TileType })],
  }));
  assert.deepEqual(layoutDependencies(out), ['tile-birds', 'tile-quote']);
});

test('a layout of only built-ins has no dependencies', () => {
  assert.deepEqual(layoutDependencies(toPublishedLayout(src())), []);
});

test('isPublishedLayout accepts what we produce', () => {
  assert.ok(isPublishedLayout(toPublishedLayout(src())));
});

test('isPublishedLayout rejects malformed and future payloads', () => {
  assert.equal(isPublishedLayout(null), false);
  assert.equal(isPublishedLayout({}), false);
  assert.equal(isPublishedLayout({ v: 2, landscape: [], portrait: [] }), false,
    'a future schema version must be refused, not half-read');
  assert.equal(isPublishedLayout({ v: 1, landscape: 'nope', portrait: [] }), false);
  assert.equal(
    isPublishedLayout({ v: 1, landscape: [{ type: 'x', rect: { x: 5, y: 0, w: 1, h: 1 } }], portrait: [] }),
    false,
    'a rect outside the unit square is not readable',
  );
  assert.equal(
    isPublishedLayout({ v: 1, landscape: [{ type: '', rect: { x: 0, y: 0, w: 1, h: 1 } }], portrait: [] }),
    false,
    'an empty tile type is not readable',
  );
});
