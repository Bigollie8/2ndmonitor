import { test } from 'node:test';
import assert from 'node:assert/strict';

import { executeAction, type ActionContext } from './actions';
import type { VizMode } from '../types';

const makeCtx = (overrides: Partial<ActionContext> = {}): ActionContext => ({
  vizMode: 'bars',
  setVizMode: () => {},
  setActiveProfileId: () => {},
  vizIds: ['bars', 'waveform'],
  ...overrides,
});

test('executeAction cycleViz advances vizMode to a different style', async () => {
  let called: VizMode | null = null;
  const ctx = makeCtx({ vizMode: 'bars', setVizMode: (m) => { called = m; } });
  await executeAction({ kind: 'cycleViz' }, ctx);
  assert.notEqual(called, null);
  assert.notEqual(called, 'bars');
});

test('executeAction switchProfile calls setActiveProfileId with the id', async () => {
  let called: string | null = null;
  const ctx = makeCtx({ setActiveProfileId: (id) => { called = id; } });
  await executeAction({ kind: 'switchProfile', profileId: 'p_test' }, ctx);
  assert.equal(called, 'p_test');
});

test('executeAction spotifyPlayPause does not throw outside Tauri', async () => {
  await executeAction({ kind: 'spotifyPlayPause' }, makeCtx());
});

test('executeAction spotifyNext does not throw outside Tauri', async () => {
  await executeAction({ kind: 'spotifyNext' }, makeCtx());
});

test('executeAction spotifyPrev does not throw outside Tauri', async () => {
  await executeAction({ kind: 'spotifyPrev' }, makeCtx());
});

test('executeAction discordMute does not throw outside Tauri', async () => {
  await executeAction({ kind: 'discordMute' }, makeCtx());
});

test('executeAction discordDeafen does not throw outside Tauri', async () => {
  await executeAction({ kind: 'discordDeafen' }, makeCtx());
});

import { parseStreamDeckConfig, DEFAULT_STREAMDECK_CONFIG } from './actions';

test('parseStreamDeckConfig: undefined input returns defaults', () => {
  assert.deepEqual(parseStreamDeckConfig(undefined), DEFAULT_STREAMDECK_CONFIG);
});

test('parseStreamDeckConfig: malformed input returns defaults', () => {
  assert.deepEqual(parseStreamDeckConfig({ random: 'junk' }), DEFAULT_STREAMDECK_CONFIG);
  assert.deepEqual(parseStreamDeckConfig(42 as unknown), DEFAULT_STREAMDECK_CONFIG);
  assert.deepEqual(parseStreamDeckConfig({ buttons: 'not an array' }), DEFAULT_STREAMDECK_CONFIG);
});

test('parseStreamDeckConfig: valid input is preserved', () => {
  const valid = {
    buttons: [
      { buttonId: 'b1', icon: '⏯', action: { kind: 'spotifyPlayPause' } },
      { buttonId: 'b2', icon: '▦', label: 'Work', color: '#ff0000', action: { kind: 'switchProfile', profileId: 'p1' } },
    ],
    cols: 4,
    rows: 2,
  };
  const out = parseStreamDeckConfig(valid);
  assert.equal(out.buttons.length, 2);
  assert.equal(out.buttons[0]?.buttonId, 'b1');
  assert.equal(out.buttons[1]?.label, 'Work');
  assert.equal(out.cols, 4);
  assert.equal(out.rows, 2);
});

test('parseStreamDeckConfig: cols/rows clamped to [1, 8]', () => {
  const wild = { buttons: [], cols: 99, rows: 0 };
  const out = parseStreamDeckConfig(wild);
  assert.equal(out.cols, 8);
  assert.equal(out.rows, 1);
});
