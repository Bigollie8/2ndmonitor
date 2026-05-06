import { test } from 'node:test';
import assert from 'node:assert/strict';

import { executeAction, type ActionContext } from './actions';
import type { VizMode } from '../types';

const makeCtx = (overrides: Partial<ActionContext> = {}): ActionContext => ({
  vizMode: 'bars',
  setVizMode: () => {},
  setActiveProfileId: () => {},
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
