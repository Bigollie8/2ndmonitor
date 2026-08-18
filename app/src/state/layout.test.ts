import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clampRectFrac,
  renderRectFrac,
  snapFrac,
  legacyRectToFraction,
  findEmptyRect,
  CHROME_TOP_PX,
  CHROME_BOTTOM_PX,
  MIN_SIZE_PX,
  SNAP_FRAC,
  DEFAULT_LANDSCAPE_LAYOUT,
  DEFAULT_PORTRAIT_LAYOUT,
  removeTilesOfType,
  reclampTilesBelowChrome,
  reclampProfilesBelowChrome,
  paintOrder,
  occupiedRects,
} from './layout';
import type { TileInstance } from './layout';

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

test('DEFAULT_PORTRAIT_LAYOUT contains all tile types', () => {
  const ids = Object.keys(DEFAULT_PORTRAIT_LAYOUT).sort();
  // Note: JS default sort is codepoint-based, so capital Q < lowercase i
  // (airQuality precedes aircraft, etc.).
  assert.deepEqual(ids, [
    'activeWindow', 'airQuality', 'aircraft', 'aurora', 'claude',
    'clock', 'dateTime', 'discord', 'docker', 'energy', 'gold',
    'homeAssistant', 'iss', 'lawsOfPower', 'lightning', 'mixer',
    'musicLyrics', 'musicPlayer', 'musicQueue', 'news', 'notes',
    'onThisDay', 'pollen', 'pomodoro',
    'scratchpad', 'solarFlare', 'spotify', 'stocks', 'streamChat',
    'streamDeck', 'sun', 'sysmon', 'tides', 'viz', 'weatherRadar',
  ]);
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

import {
  findInstance, getInstance, addInstance, removeInstance, updateInstance,
  type TileInstance,
} from './layout';

const MK = (instanceId: string, type: 'viz' | 'spotify' | 'discord'): TileInstance => ({
  instanceId, type, rect: { x: 0, y: 0, w: 0.1, h: 0.1 },
});

test('findInstance: returns first match by type', () => {
  const tiles = [MK('a', 'viz'), MK('b', 'spotify')];
  const found = findInstance(tiles, 'spotify');
  assert.equal(found?.instanceId, 'b');
});

test('findInstance: returns undefined when no match', () => {
  const tiles = [MK('a', 'viz')];
  assert.equal(findInstance(tiles, 'spotify'), undefined);
});

test('getInstance: matches by instanceId', () => {
  const tiles = [MK('a', 'viz'), MK('b', 'spotify')];
  assert.equal(getInstance(tiles, 'b')?.type, 'spotify');
  assert.equal(getInstance(tiles, 'nope'), undefined);
});

test('addInstance: appends without mutating', () => {
  const before = [MK('a', 'viz')];
  const after = addInstance(before, MK('b', 'spotify'));
  assert.equal(after.length, 2);
  assert.equal(before.length, 1);
  assert.equal(after[1]?.instanceId, 'b');
});

test('removeInstance: filters out matching id, preserves others', () => {
  const before = [MK('a', 'viz'), MK('b', 'spotify'), MK('c', 'discord')];
  const after = removeInstance(before, 'b');
  assert.equal(after.length, 2);
  assert.equal(after[0]?.instanceId, 'a');
  assert.equal(after[1]?.instanceId, 'c');
  assert.equal(before.length, 3);
});

test('updateInstance: patches matching instance, leaves others unchanged', () => {
  const before = [MK('a', 'viz'), MK('b', 'spotify')];
  const after = updateInstance(before, 'a', { rect: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 } });
  assert.equal(after[0]?.rect.x, 0.5);
  assert.equal(after[1]?.rect.x, 0);
  assert.equal(before[0]?.rect.x, 0);
});

import { migrateLayoutHiddenToTiles, ALL_TILE_TYPES } from './layout';

test('migrateLayoutHiddenToTiles: empty layout+hidden produces full default tile list', () => {
  const tiles = migrateLayoutHiddenToTiles({}, {}, DEFAULT_LANDSCAPE_LAYOUT);
  assert.equal(tiles.length, ALL_TILE_TYPES.length);
  // Each instance has a unique instanceId
  const ids = tiles.map((t) => t.instanceId);
  assert.equal(new Set(ids).size, ids.length);
});

test('migrateLayoutHiddenToTiles: hidden type is excluded from result', () => {
  const tiles = migrateLayoutHiddenToTiles({}, { discord: true }, DEFAULT_LANDSCAPE_LAYOUT);
  assert.equal(tiles.length, ALL_TILE_TYPES.length - 1);
  assert.equal(tiles.find((t) => t.type === 'discord'), undefined);
});

test('migrateLayoutHiddenToTiles: custom layout rect is preserved, others use defaults', () => {
  const customRect = { x: 0.5, y: 0.5, w: 0.3, h: 0.3 };
  const layout: Layout = { viz: customRect };
  const tiles = migrateLayoutHiddenToTiles(layout, {}, DEFAULT_LANDSCAPE_LAYOUT);
  const vizInst = tiles.find((t) => t.type === 'viz');
  assert.deepEqual(vizInst?.rect, customRect);
  // Spotify uses default
  const spotifyInst = tiles.find((t) => t.type === 'spotify');
  assert.deepEqual(spotifyInst?.rect, DEFAULT_LANDSCAPE_LAYOUT.spotify);
});

test('migrateLayoutHiddenToTiles: result preserves ALL_TILE_TYPES order', () => {
  const tiles = migrateLayoutHiddenToTiles({}, {}, DEFAULT_LANDSCAPE_LAYOUT);
  const types = tiles.map((t) => t.type);
  assert.deepEqual(types, ALL_TILE_TYPES);
});

test('removeTilesOfType: drops every instance matching the type, keeps the rest', () => {
  const tiles: TileInstance[] = [
    { instanceId: 'a', type: 'notes', rect: { x: 0, y: 0, w: 1, h: 1 } },
    { instanceId: 'b', type: 'clock', rect: { x: 0, y: 0, w: 1, h: 1 } },
    { instanceId: 'c', type: 'notes', rect: { x: 0, y: 0, w: 1, h: 1 } },
  ];
  const out = removeTilesOfType(tiles, 'notes');
  assert.deepEqual(out.map((t) => t.instanceId), ['b']);
});

test('removeTilesOfType: matches bundle: ids by exact type, not by prefix', () => {
  const tiles: TileInstance[] = [
    { instanceId: 'a', type: 'bundle:foo', rect: { x: 0, y: 0, w: 1, h: 1 } },
    { instanceId: 'b', type: 'bundle:foobar', rect: { x: 0, y: 0, w: 1, h: 1 } },
  ];
  const out = removeTilesOfType(tiles, 'bundle:foo');
  assert.deepEqual(out.map((t) => t.instanceId), ['b']);
});

test('removeTilesOfType: no match leaves the array unchanged (by value)', () => {
  const tiles: TileInstance[] = [
    { instanceId: 'a', type: 'notes', rect: { x: 0, y: 0, w: 1, h: 1 } },
  ];
  assert.deepEqual(removeTilesOfType(tiles, 'clock'), tiles);
});

import { remapRetiredTileType } from './layout';

test('remapRetiredTileType: retired built-ins point at their bundle ids', () => {
  assert.equal(remapRetiredTileType('quote'), 'bundle:tile-quote');
  assert.equal(remapRetiredTileType('wordOfDay'), 'bundle:tile-dictionary');
  assert.equal(remapRetiredTileType('dailyChallenge'), 'bundle:tile-dailychallenge');
  assert.equal(remapRetiredTileType('randomWiki'), 'bundle:tile-randomwiki');
  assert.equal(remapRetiredTileType('launches'), 'bundle:tile-launches');
  assert.equal(remapRetiredTileType('githubPrs'), 'bundle:tile-githubprs');
  assert.equal(remapRetiredTileType('phoneNotifs'), 'bundle:tile-phonenotifs');
  assert.equal(remapRetiredTileType('birds'), 'bundle:tile-birds');
});

test('remapRetiredTileType: a live built-in is unchanged', () => {
  assert.equal(remapRetiredTileType('mixer'), 'mixer');
});

test('remapRetiredTileType: onThisDay and stocks stay built-in (additional listings, not replacements)', () => {
  assert.equal(remapRetiredTileType('onThisDay'), 'onThisDay');
  assert.equal(remapRetiredTileType('stocks'), 'stocks');
});

test('remapRetiredTileType: an already-bundle type is unchanged', () => {
  assert.equal(remapRetiredTileType('bundle:tile-quote'), 'bundle:tile-quote');
});

// ---------------------------------------------------------------------------
// repairPileTiles (0.6.7 §1 — legacy tile-pile repair)
// ---------------------------------------------------------------------------
import { repairPileTiles, DEFAULT_BUNDLE_TILE_RECT } from './layout';

/** Real-data fixture: mirrors the developer's pre-0.6.1 tweaks.json, where
 *  portrait piles were exactly these 9 types materialized at exact portrait
 *  defaults, alongside tiles the user actually arranged (rects differing
 *  from defaults). Every one of the 9 overlaps at least one other at the
 *  default portrait rects (pomodoro↔discord, sun↔mixer, streamDeck↔claude/
 *  sysmon/clock/aurora, …). */
const PORTRAIT_PILE_TYPES = [
  'discord', 'claude', 'mixer', 'sysmon', 'clock',
  'streamDeck', 'pomodoro', 'sun', 'aurora',
] as const;

function portraitPileFixture(): TileInstance[] {
  const arranged: TileInstance[] = [
    { instanceId: 'kept-viz', type: 'viz', rect: { x: 0.02, y: 0.05, w: 0.96, h: 0.38 } },
    { instanceId: 'kept-spotify', type: 'spotify', rect: { x: 0.02, y: 0.45, w: 0.96, h: 0.10 } },
  ];
  const junk: TileInstance[] = PORTRAIT_PILE_TYPES.map((type, i) => ({
    instanceId: `junk-${i}`,
    type,
    rect: { ...DEFAULT_PORTRAIT_LAYOUT[type] },
  }));
  return [...arranged, ...junk];
}

test('repairPileTiles: real-data portrait pile — all 9 junk tiles removed, arranged tiles kept', () => {
  const tiles = portraitPileFixture();
  const out = repairPileTiles(tiles, DEFAULT_PORTRAIT_LAYOUT, DEFAULT_BUNDLE_TILE_RECT.portrait);
  assert.deepEqual(out.map((t) => t.instanceId), ['kept-viz', 'kept-spotify']);
});

test('repairPileTiles: arranged layout (rects differ from defaults) is untouched, even when tiles overlap', () => {
  // Rects are near-but-not-at defaults (off by ~0.01 ≫ the 1e-9 epsilon) and
  // deliberately overlapping — user-arranged mess is the user's to keep.
  const tiles: TileInstance[] = [
    { instanceId: 'a', type: 'pomodoro', rect: { x: 0.06, y: 0.56, w: 0.20, h: 0.18 } },
    { instanceId: 'b', type: 'scratchpad', rect: { x: 0.10, y: 0.60, w: 0.20, h: 0.18 } },
    { instanceId: 'c', type: 'viz', rect: { x: 0.30, y: 0.10, w: 0.60, h: 0.40 } },
  ];
  const out = repairPileTiles(tiles, DEFAULT_LANDSCAPE_LAYOUT, DEFAULT_BUNDLE_TILE_RECT.landscape);
  assert.equal(out, tiles); // same reference — nothing to repair
});

test('repairPileTiles: threshold — a single signature tile is left alone', () => {
  // streamDeck sits at its exact portrait default and overlaps an arranged
  // tile, but it is the ONLY signature tile → below the ≥2 threshold.
  const tiles: TileInstance[] = [
    { instanceId: 'sd', type: 'streamDeck', rect: { ...DEFAULT_PORTRAIT_LAYOUT.streamDeck } },
    { instanceId: 'arranged', type: 'notes', rect: { x: 0.10, y: 0.75, w: 0.50, h: 0.10 } },
  ];
  const out = repairPileTiles(tiles, DEFAULT_PORTRAIT_LAYOUT, DEFAULT_BUNDLE_TILE_RECT.portrait);
  assert.equal(out, tiles);
});

test('repairPileTiles: default-rect tiles that do not overlap anything are not signature tiles', () => {
  // viz and notes at exact portrait defaults never overlap each other, so
  // neither matches the pile signature and both survive.
  const tiles: TileInstance[] = [
    { instanceId: 'v', type: 'viz', rect: { ...DEFAULT_PORTRAIT_LAYOUT.viz } },
    { instanceId: 'n', type: 'notes', rect: { ...DEFAULT_PORTRAIT_LAYOUT.notes } },
  ];
  const out = repairPileTiles(tiles, DEFAULT_PORTRAIT_LAYOUT, DEFAULT_BUNDLE_TILE_RECT.portrait);
  assert.equal(out, tiles);
});

test('repairPileTiles: epsilon — float noise (1e-12) still matches the signature', () => {
  // discord and pomodoro overlap at portrait defaults; pomodoro is off its
  // default x by 1e-12, far inside the 1e-9 epsilon → both are signature
  // tiles → threshold met → both removed.
  const pom = DEFAULT_PORTRAIT_LAYOUT.pomodoro;
  const tiles: TileInstance[] = [
    { instanceId: 'd', type: 'discord', rect: { ...DEFAULT_PORTRAIT_LAYOUT.discord } },
    { instanceId: 'p', type: 'pomodoro', rect: { x: pom.x + 1e-12, y: pom.y, w: pom.w, h: pom.h } },
  ];
  const out = repairPileTiles(tiles, DEFAULT_PORTRAIT_LAYOUT, DEFAULT_BUNDLE_TILE_RECT.portrait);
  assert.deepEqual(out, []);
});

test('repairPileTiles: epsilon — a real offset (1e-6) does not match, threshold not met', () => {
  // Same pair, but pomodoro is off by 1e-6 (> epsilon) → not a signature
  // tile. Only discord qualifies → below the ≥2 threshold → untouched.
  const pom = DEFAULT_PORTRAIT_LAYOUT.pomodoro;
  const tiles: TileInstance[] = [
    { instanceId: 'd', type: 'discord', rect: { ...DEFAULT_PORTRAIT_LAYOUT.discord } },
    { instanceId: 'p', type: 'pomodoro', rect: { x: pom.x + 1e-6, y: pom.y, w: pom.w, h: pom.h } },
  ];
  const out = repairPileTiles(tiles, DEFAULT_PORTRAIT_LAYOUT, DEFAULT_BUNDLE_TILE_RECT.portrait);
  assert.equal(out, tiles);
});

test('repairPileTiles: bundle tiles match against the shared bundle default rect', () => {
  // A `bundle:` tile has no entry in the builtin default maps — its default
  // is DEFAULT_BUNDLE_TILE_RECT. Here it overlaps a junk weatherRadar at
  // its portrait default → 2 signature tiles → both removed.
  const tiles: TileInstance[] = [
    { instanceId: 'b1', type: 'bundle:tile-quote', rect: { ...DEFAULT_BUNDLE_TILE_RECT.portrait } },
    { instanceId: 'wr', type: 'weatherRadar', rect: { ...DEFAULT_PORTRAIT_LAYOUT.weatherRadar } },
  ];
  const out = repairPileTiles(tiles, DEFAULT_PORTRAIT_LAYOUT, DEFAULT_BUNDLE_TILE_RECT.portrait);
  assert.deepEqual(out, []);
});

test('repairPileTiles: landscape pile — identical default rects overlap and are removed, arranged kept', () => {
  // landscape pomodoro and scratchpad share the exact same default rect
  // ({x:0.05,y:0.55,w:0.20,h:0.18}) — the classic landscape pile shape.
  const tiles: TileInstance[] = [
    { instanceId: 'kept', type: 'viz', rect: { x: 0.30, y: 0.10, w: 0.65, h: 0.40 } },
    { instanceId: 'j1', type: 'pomodoro', rect: { ...DEFAULT_LANDSCAPE_LAYOUT.pomodoro } },
    { instanceId: 'j2', type: 'scratchpad', rect: { ...DEFAULT_LANDSCAPE_LAYOUT.scratchpad } },
  ];
  const out = repairPileTiles(tiles, DEFAULT_LANDSCAPE_LAYOUT, DEFAULT_BUNDLE_TILE_RECT.landscape);
  assert.deepEqual(out.map((t) => t.instanceId), ['kept']);
});

test('clampRectFrac: topInsetPx 0 lets a rect sit at y=0 (0.7.2 §2)', () => {
  const c = clampRectFrac({ x: 0.1, y: 0, w: 0.2, h: 0.2 }, { w: 2560, h: 1440 }, 0);
  assert.equal(c.y, 0);
});

test('clampRectFrac: topInsetPx 0 still enforces bottom chrome and min size', () => {
  const c = clampRectFrac({ x: 0.1, y: 0.99, w: 0.001, h: 0.001 }, { w: 2560, h: 1440 }, 0);
  assert.ok(c.y + c.h <= 1 - 32 / 1440 + 1e-9);
  assert.ok(c.w >= 200 / 2560 - 1e-9);
});

test('findEmptyRect: topInsetPx 0 opens the top band for placement (0.7.2 §2)', () => {
  const canvas = { w: 2560, h: 1440 };
  const topF = CHROME_TOP_PX / canvas.h;
  // Wall of tiles covering everything BELOW the chrome band.
  const wall = [{ x: 0, y: topF, w: 1, h: 1 - topF }];
  const preferred = { x: 0.4, y: 0.5, w: 0.2, h: topF * 0.9 };
  const withInset = findEmptyRect(wall, preferred, canvas);
  assert.deepEqual(withInset, preferred); // no slot with the default inset → preferred returned
  const freed = findEmptyRect(wall, preferred, canvas, 0);
  assert.ok(freed.y < topF); // the freed band is now a valid slot
  assert.equal(freed.w, preferred.w);
  assert.equal(freed.h, preferred.h);
});

test('reclampTilesBelowChrome: moves banded tiles down, size preserved', () => {
  const canvas = { w: 2560, h: 1440 };
  const topF = CHROME_TOP_PX / canvas.h;
  const banded = { instanceId: 'a', type: 'notes' as const, rect: { x: 0.1, y: 0, w: 0.3, h: 0.2 } };
  const fine = { instanceId: 'b', type: 'clock' as const, rect: { x: 0.5, y: 0.5, w: 0.3, h: 0.2 } };
  const out = reclampTilesBelowChrome([banded, fine], canvas);
  assert.equal(out[0]!.rect.y, topF);
  assert.equal(out[0]!.rect.w, 0.3);
  assert.equal(out[0]!.rect.h, 0.2);
  assert.equal(out[1], fine); // untouched tile keeps its reference
});

test('reclampTilesBelowChrome: nothing in the band → same array reference', () => {
  const tiles = [{ instanceId: 'b', type: 'clock' as const, rect: { x: 0.5, y: 0.5, w: 0.3, h: 0.2 } }];
  assert.equal(reclampTilesBelowChrome(tiles, { w: 2560, h: 1440 }), tiles);
});

test('reclampProfilesBelowChrome: sweeps both orientations of every profile', () => {
  const mk = (y: number) => [{ instanceId: 'x', type: 'notes' as const, rect: { x: 0.1, y, w: 0.3, h: 0.2 } }];
  const dirty = { id: 'p1', landscape: { tiles: mk(0) }, portrait: { tiles: mk(0.5) } };
  const clean = { id: 'p2', landscape: { tiles: mk(0.5) }, portrait: { tiles: mk(0.5) } };
  const canvasByOrientation = { landscape: LANDSCAPE, portrait: PORTRAIT };
  const out = reclampProfilesBelowChrome([dirty, clean], canvasByOrientation);
  assert.ok(out[0]!.landscape.tiles[0]!.rect.y >= 56 / 1440 - 1e-9);
  assert.equal(out[0]!.portrait.tiles[0]!.rect.y, 0.5);
  assert.equal(out[1], clean); // clean profile keeps its reference
  const cleanOnly = [clean];
  assert.equal(reclampProfilesBelowChrome(cleanOnly, canvasByOrientation), cleanOnly); // all-clean → same reference
});

test('reclampProfilesBelowChrome: uses the LIVE canvas per orientation, not a fixed reference (0.7.2 §2 fix, 1080p repro)', () => {
  // Bug this guards against: a fixed 2560x1440 reference clamps a banded
  // tile's y to 56/1440 ≈ 0.038889. Converted back through a real, shorter
  // 1920x1080 window that is 0.038889 * 1080 ≈ 42px — still under the real
  // 56px bar, permanently. Passing the LIVE canvas fixes it: y must land at
  // exactly 56/1080 (≈ 0.051852), which is >= the real bar on that canvas.
  const mk = (y: number) => [{ instanceId: 'x', type: 'notes' as const, rect: { x: 0.1, y, w: 0.3, h: 0.2 } }];
  const live1080 = { w: 1920, h: 1080 };
  const dirty = { id: 'p1', landscape: { tiles: mk(0) }, portrait: { tiles: mk(0.5) } };
  const out = reclampProfilesBelowChrome([dirty], { landscape: live1080, portrait: PORTRAIT });
  assert.equal(out[0]!.landscape.tiles[0]!.rect.y, CHROME_TOP_PX / live1080.h);
  // The old bug's y (56/1440, i.e. 42px on a 1080-tall canvas) is NOT
  // reached — the fix lands strictly higher (further from the bar).
  assert.ok(out[0]!.landscape.tiles[0]!.rect.y > 56 / 1440);
});

// ── 0.9.4: renderRectFrac — chrome clamp on smaller-than-design canvases ─────

test('renderRectFrac is an exact no-op for the design canvas', () => {
  const canvas = { w: 2560, h: 1440 };
  for (const r of Object.values(DEFAULT_LANDSCAPE_LAYOUT)) {
    assert.deepEqual(renderRectFrac(r, canvas), r);
  }
});

test('renderRectFrac pushes below the top bar by SHRINKING, keeping the bottom edge', () => {
  // 56px at 1440p = y 0.0389; the same fraction at 864p is 34px — under the bar.
  const canvas = { w: 1536, h: 864 };
  const r = { x: 0.1, y: 56 / 1440, w: 0.4, h: 0.3 };
  const out = renderRectFrac(r, canvas);
  assert.ok(out.y * canvas.h >= 56 - 1e-6, `top clears the bar, got ${out.y * canvas.h}px`);
  const origBottom = r.y + r.h;
  assert.ok(Math.abs((out.y + out.h) - origBottom) < 1e-9, 'bottom edge unchanged — no cascade into the next row');
});

test('renderRectFrac keeps bottoms above the bottom bar at 1080p', () => {
  const canvas = { w: 1920, h: 1080 };
  const r = { x: 0.1, y: 0.6, w: 0.4, h: (1 - 32 / 1440) - 0.6 }; // legal at 1440p
  const out = renderRectFrac(r, canvas);
  assert.ok((out.y + out.h) <= 1 - 32 / 1080 + 1e-9, 'bottom clears the bar');
  assert.equal(out.y, r.y, 'top edge untouched when only the bottom collides');
});

test('renderRectFrac minimums are capped at the design fraction on small canvases', () => {
  // A short tile that is legal at 1440p must not be inflated past its slot at 864p.
  const canvas = { w: 1536, h: 864 };
  const r = { x: 0.1, y: 0.5, w: 0.4, h: 140 / 1440 };
  const out = renderRectFrac(r, canvas);
  assert.ok(out.h <= r.h + 1e-9, `height not inflated: ${out.h} vs ${r.h}`);
});

test('paintOrder puts viz backdrops first, keeps relative order, no-ops without viz', () => {
  const mk = (type: string, id: string) => ({ instanceId: id, type, rect: { x: 0, y: 0, w: 0.1, h: 0.1 } }) as unknown as import('./layout').TileInstance;
  const tiles = [mk('clock', 'a'), mk('viz', 'v1'), mk('notes', 'b'), mk('viz', 'v2')];
  const out = paintOrder(tiles);
  assert.deepEqual(out.map((t) => t.instanceId), ['v1', 'v2', 'a', 'b']);
  const noViz = [mk('clock', 'a'), mk('notes', 'b')];
  assert.equal(paintOrder(noViz), noViz, 'returned by reference when nothing to move');
  const stored = tiles.map((t) => t.instanceId);
  assert.deepEqual(tiles.map((t) => t.instanceId), stored, 'input array untouched');
});

test('occupiedRects excludes the viz backdrop so placement can use its space', () => {
  const mk = (type: string, x: number) => ({ instanceId: type + x, type, rect: { x, y: 0.2, w: 0.2, h: 0.2 } }) as unknown as import('./layout').TileInstance;
  const tiles = [mk('viz', 0), mk('clock', 0.4)];
  const occ = occupiedRects(tiles);
  assert.equal(occ.length, 1);
  assert.equal(occ[0].x, 0.4);
});

test('findEmptyRect over occupiedRects places on top of a full-bleed viz', () => {
  const viz = { instanceId: 'v', type: 'viz', rect: { x: 0, y: 0, w: 1, h: 1 } } as unknown as import('./layout').TileInstance;
  const clock = { instanceId: 'c', type: 'clock', rect: { x: 0.4, y: 0.3, w: 0.3, h: 0.3 } } as unknown as import('./layout').TileInstance;
  const preferred = { x: 0.45, y: 0.35, w: 0.2, h: 0.2 }; // collides with clock only
  const rect = findEmptyRect(occupiedRects([viz, clock]), preferred, { w: 2560, h: 1440 });
  // an empty slot exists (the viz doesn't block), and it must not overlap the clock
  const overlaps = rect.x < 0.7 && rect.x + rect.w > 0.4 && rect.y < 0.6 && rect.y + rect.h > 0.3;
  assert.ok(!overlaps, `placed clear of the real tile: ${JSON.stringify(rect)}`);
});
