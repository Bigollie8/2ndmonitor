import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useLayoutHistory } from './useLayoutHistory';
import { seedStarterProfiles } from './starterProfiles';
import type { Profile } from '../types';

test('layout edits create a durable checkpoint, undo preserves it, and external import clears session history', async () => {
  let profiles!: Profile[];
  let replace!: (p: Profile[]) => void;
  let history!: ReturnType<typeof useLayoutHistory>;
  function Probe() {
    const [state, set] = useState(seedStarterProfiles);
    profiles = state; replace = set; history = useLayoutHistory(state, set, true);
    return null;
  }
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(createElement(Probe)); });
  const original = profiles[0]!;
  await act(async () => history.setProfiles(profiles.map((p, i) => i ? p : { ...p, landscape: { tiles: [] } })));
  assert.deepEqual(profiles[0]!.layoutCheckpoints!.landscape, original.landscape);
  assert.equal(history.available(original.id, 'landscape').undo, true);
  await act(async () => history.move(original.id, 'landscape', 'undo'));
  assert.deepEqual(profiles[0]!.landscape, original.landscape);
  assert.deepEqual(profiles[0]!.layoutCheckpoints!.landscape, original.landscape);
  assert.equal(history.available(original.id, 'landscape').redo, true);
  await act(async () => replace(structuredClone(profiles)));
  assert.deepEqual(history.available(original.id, 'landscape'), { undo: false, redo: false });
  assert.ok(profiles[0]!.layoutCheckpoints!.landscape);
  await act(async () => tree.unmount());
});
