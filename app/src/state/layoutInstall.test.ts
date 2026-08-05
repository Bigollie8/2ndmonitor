import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLayout, applyLayout, uniqueLayoutName } from './layoutInstall';
import type { PublishedLayout } from './layoutPublish';
import type { CatalogItem } from './catalog';

const item = (o: Partial<CatalogItem> = {}): CatalogItem => ({
  key: 'tile:x', kind: 'tile', id: 'x', name: 'X', description: '', category: 'weather',
  source: 'bundle', installed: false, installedVersion: null, availableVersion: '1.0.0',
  updateAvailable: false, permissions: [], needsSetup: false, downloads: 0, brokenReason: null,
  removed: false, hasPreview: false, rating: null,
  summary: null, tags: [], icon: null, changelog: null, minAppVersion: null,
  featured: false, approvedAt: null, mediaCount: 0, authorDisplay: null, authorHandle: null, ...o,
});

const layout = (o: Partial<PublishedLayout> = {}): PublishedLayout => ({
  v: 1,
  landscape: [{ type: 'bundle:tile-quote', rect: { x: 0, y: 0, w: 0.5, h: 0.5 } }],
  portrait: [],
  theme: { accent: '#7cf5d4', accent2: '#a5b4fc', density: 'comfortable', glass: true, vizMode: 'aurora' },
  ...o,
});

let counter = 0;
const newId = () => `id-${++counter}`;

test('a dependency present but not installed is installable', () => {
  const r = resolveLayout(layout(), [item({ id: 'tile-quote', installed: false })]);
  assert.deepEqual(r.installable.map((i) => i.id), ['tile-quote']);
  assert.deepEqual(r.alreadyInstalled, []);
  assert.deepEqual(r.unavailable, []);
});

test('a dependency already installed is counted, not reinstalled', () => {
  const r = resolveLayout(layout(), [item({ id: 'tile-quote', installed: true })]);
  assert.deepEqual(r.installable, []);
  assert.deepEqual(r.alreadyInstalled.map((i) => i.id), ['tile-quote']);
});

// Named rather than silently dropped: the installer should learn which tiles
// will land broken before pressing the button, not afterwards.
test('a dependency the catalog has never heard of is reported by name', () => {
  const r = resolveLayout(layout(), []);
  assert.deepEqual(r.unavailable, ['tile-quote']);
});

test('built-in tiles are not dependencies', () => {
  const r = resolveLayout(
    layout({ landscape: [{ type: 'clock', rect: { x: 0, y: 0, w: 1, h: 1 } }] }),
    [],
  );
  assert.deepEqual(r.unavailable, []);
  assert.deepEqual(r.installable, []);
});

test('applying a layout produces placed instances with fresh ids', () => {
  counter = 0;
  const applied = applyLayout(layout(), newId);
  assert.equal(applied.landscape.length, 1);
  assert.equal(applied.landscape[0].instanceId, 'id-1');
  assert.equal(applied.landscape[0].type, 'bundle:tile-quote');
  assert.deepEqual(applied.landscape[0].rect, { x: 0, y: 0, w: 0.5, h: 0.5 });
});

test('two installs of the same layout do not share instance ids', () => {
  counter = 0;
  const a = applyLayout(layout(), newId);
  const b = applyLayout(layout(), newId);
  assert.notEqual(a.landscape[0].instanceId, b.landscape[0].instanceId);
});

// The publisher's config was never transmitted. Inventing one here would put
// made-up values in front of the user instead of the tile's setup prompt.
test('applied tiles carry no config', () => {
  counter = 0;
  const applied = applyLayout(layout(), newId);
  assert.equal(applied.landscape[0].config, undefined);
});

// The arrangement has to survive a missing bundle: the gap renders as
// MissingTileCard, which is visible and fixable. Dropping the tile would
// silently change the layout the author published.
test('a tile whose bundle is unavailable is still placed', () => {
  counter = 0;
  const applied = applyLayout(
    layout({ landscape: [{ type: 'bundle:not-in-catalog', rect: { x: 0, y: 0, w: 1, h: 1 } }] }),
    newId,
  );
  assert.equal(applied.landscape.length, 1, 'the tile is kept so the shape survives');
  assert.equal(applied.landscape[0].type, 'bundle:not-in-catalog');
});

test('both orientations are applied and the theme comes across', () => {
  counter = 0;
  const applied = applyLayout(layout({
    portrait: [{ type: 'clock', rect: { x: 0, y: 0, w: 1, h: 0.2 } }],
  }), newId);
  assert.equal(applied.portrait.length, 1);
  assert.equal(applied.theme.accent, '#7cf5d4');
});

// Installing must ADD a layout, never replace one. Silently overwriting
// "Work" because the author also called theirs "Work" destroys a dashboard.
test('an installed layout never takes an existing name', () => {
  assert.equal(uniqueLayoutName('Work', []), 'Work');
  assert.equal(uniqueLayoutName('Work', ['Work']), 'Work 2');
  assert.equal(uniqueLayoutName('Work', ['Work', 'Work 2']), 'Work 3');
});

test('name collision is case- and whitespace-insensitive', () => {
  assert.equal(uniqueLayoutName('work', ['  WORK ']), 'work 2');
});

test('a blank desired name still yields something usable', () => {
  assert.equal(uniqueLayoutName('   ', []), 'Layout');
});
