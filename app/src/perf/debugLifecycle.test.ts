import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import * as debug from './debug';
test('perf toggle stops collection and preserves attribution of already mounted surfaces', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let callback!: ResizeObserverCallback;
  class RO { constructor(cb: ResizeObserverCallback) { callback = cb; } }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    ResizeObserver: RO, addEventListener() {}, removeEventListener() {},
  } });
  function Probe() { debug.useRegisterSurface('test-surface'); return null; }
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(createElement(Probe)); });
  try {
    await act(async () => debug.enable());
    assert.deepEqual(debug.getSnapshot().surfaces, ['test-surface']);
    new window.ResizeObserver(() => {});
    callback([{} as ResizeObserverEntry], {} as ResizeObserver);
    assert.equal(debug.getSnapshot().roFiresLast5s, 1);
    debug.recordAppResources(7.5, 256);
    t.mock.timers.tick(2000);
    assert.equal(debug.getSessionLog()?.size, 1);
    assert.equal(debug.getSessionLog()?.last()?.cpu, 7.5);
    assert.equal(debug.getSessionLog()?.last()?.ramMb, 256);
    await act(async () => debug.disable());
    callback([{} as ResizeObserverEntry], {} as ResizeObserver);
    t.mock.timers.tick(2000);
    assert.equal(debug.getSnapshot().roFiresLast5s, 0);
    assert.equal(debug.getSessionLog(), null);
    await act(async () => debug.enable());
    assert.deepEqual(debug.getSnapshot().surfaces, ['test-surface']);
  } finally {
    await act(async () => debug.disable());
    await act(async () => tree.unmount());
    Reflect.deleteProperty(globalThis, 'window');
  }
});
