import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startPollLoop } from './pollLoop';
import { setWindowHidden } from './framePace';

test('hidden mount defers work; native resume catches up once; cleanup stops future work', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const results: number[] = [];
  let calls = 0;
  setWindowHidden(true);
  const stop = startPollLoop({ fetcher: async () => ++calls, intervalMs: 1000,
    onData: n => results.push(n), onError: () => assert.fail('unexpected error') });
  try {
    assert.equal(calls, 0);
    setWindowHidden(false);
    await Promise.resolve();
    assert.deepEqual(results, [1]);
    setWindowHidden(true);
    t.mock.timers.tick(5000);
    assert.equal(calls, 1);
    setWindowHidden(false);
    await Promise.resolve();
    assert.deepEqual(results, [1, 2]);
    stop();
    t.mock.timers.tick(5000);
    setWindowHidden(true);
    setWindowHidden(false);
    assert.equal(calls, 2);
  } finally { stop(); setWindowHidden(false); }
});

test('a response from a stopped generation cannot overwrite its successor', async () => {
  let resolve!: (n: number) => void;
  const results: number[] = [];
  const stop = startPollLoop({ fetcher: () => new Promise<number>(r => { resolve = r; }),
    intervalMs: 1000, onData: n => results.push(n), onError: () => assert.fail('unexpected error') });
  stop();
  resolve(1);
  await Promise.resolve();
  assert.deepEqual(results, []);
});

test('errors back off and successful polling restores the normal interval', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  let errors = 0;
  const stop = startPollLoop({ fetcher: async () => { if (++calls === 1) throw new Error('offline'); return calls; },
    intervalMs: 1000, onData: () => {}, onError: () => { errors++; } });
  try {
    await Promise.resolve();
    assert.equal(errors, 1);
    t.mock.timers.tick(1999);
    assert.equal(calls, 1);
    t.mock.timers.tick(1);
    await Promise.resolve();
    assert.equal(calls, 2);
    t.mock.timers.tick(1000);
    await Promise.resolve();
    assert.equal(calls, 3);
  } finally { stop(); }
});
