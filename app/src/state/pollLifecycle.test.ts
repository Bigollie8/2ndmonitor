import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { usePoll } from './usePoll';
import { pollHealth } from './pollHealth';
import { setWindowHidden } from './framePace';

const settle = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
test('polling retains successful data on payload errors, exposes retry and clears old-source health', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let answer: { value?: number; error?: string } = { value: 1 };
  let source = 'a';
  let state!: ReturnType<typeof usePoll<typeof answer>>;
  function Probe() { state = usePoll(async () => answer, 1000, [source], 'Test source'); return null; }
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(createElement(Probe)); await settle(); });
  const success = state.updatedAt;
  assert.ok(success); assert.equal(pollHealth.getSnapshot()[0]!.updatedAt, success);
  answer = { error: 'offline' };
  await act(async () => { t.mock.timers.tick(1000); await settle(); });
  assert.equal(state.data!.value, 1); assert.equal(state.error, 'offline'); assert.equal(state.updatedAt, success);
  assert.equal(pollHealth.getSnapshot()[0]!.failed, true);
  answer = { value: 2 };
  await act(async () => { pollHealth.getSnapshot()[0]!.retry(); await settle(); });
  assert.equal(state.data!.value, 2); assert.equal(state.error, null);
  setWindowHidden(true);
  source = 'b';
  await act(async () => tree.update(createElement(Probe)));
  assert.equal(state.data, null); assert.equal(state.updatedAt, null);
  assert.equal(pollHealth.getSnapshot()[0]!.updatedAt, null);
  await act(async () => tree.unmount());
  setWindowHidden(false); assert.equal(pollHealth.getSnapshot().length, 0);
});
