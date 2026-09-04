import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useTweaks } from './useTweaks';

const settle = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
test('slow hydration never saves defaults; failures pause saving and retry recovers', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const writes: unknown[] = [];
  const store = { load: () => new Promise<unknown>((ok, fail) => { resolve = ok; reject = fail; }), save: async (value: unknown) => { writes.push(value); } };
  let state!: ReturnType<typeof useTweaks<{ name: string }>>;
  function Probe() { state = useTweaks({ name: 'default' }, { store }); return null; }
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(createElement(Probe)); });
  await act(async () => { t.mock.timers.tick(1000); await settle(); });
  assert.deepEqual(writes, []);
  await act(async () => { reject(new Error('unreadable')); await settle(); });
  assert.match(state[4].error!, /Saving is paused/);
  await act(async () => { state[1]('name', 'edited'); t.mock.timers.tick(1000); await settle(); });
  assert.deepEqual(writes, []);
  await act(async () => { state[4].retry(); });
  await act(async () => { resolve({ name: 'saved' }); await settle(); });
  await act(async () => { t.mock.timers.tick(300); await settle(); });
  assert.equal(state[0].name, 'saved'); assert.equal(state[4].error, null);
  assert.deepEqual(writes, [{ name: 'saved' }]);
  await act(async () => tree.unmount());
});
test('serialized saves preserve newest edit and expose recoverable save errors', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let finish!: () => void;
  const writes: string[] = [];
  let fail = false;
  const store = { load: async () => ({ name: 'saved' }), save: async (value: unknown) => {
    if (fail) throw new Error('disk full');
    writes.push((value as { name: string }).name);
    if (writes.length === 1) await new Promise<void>(r => { finish = r; });
  } };
  let state!: ReturnType<typeof useTweaks<{ name: string }>>;
  function Probe() { state = useTweaks({ name: 'default' }, { store }); return null; }
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(createElement(Probe)); await settle(); });
  await act(async () => { t.mock.timers.tick(300); await settle(); });
  await act(async () => state[1]('name', 'newest'));
  await act(async () => { t.mock.timers.tick(300); await settle(); });
  assert.deepEqual(writes, ['saved']);
  await act(async () => { finish(); await settle(); });
  assert.deepEqual(writes, ['saved', 'newest']);
  fail = true;
  await act(async () => state[1]('name', 'retry-me'));
  await act(async () => { t.mock.timers.tick(300); await settle(); });
  assert.match(state[4].error!, /disk full/);
  fail = false;
  await act(async () => state[4].retry());
  await act(async () => { t.mock.timers.tick(300); await settle(); });
  assert.equal(writes.at(-1), 'retry-me'); assert.equal(state[4].error, null);
  await act(async () => tree.unmount());
});
