import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPreview, peekPreview, __resetPreviewCacheForTest } from './previewCache';

// Recording stub — counts calls and returns/rejects a fixed value, so a test
// can assert "not called again" rather than merely "the right value came
// back" (a stale value could come back correct by accident of ordering).
function recordingFetcher(result: string) {
  let calls = 0;
  const fetcher = async () => { calls++; return result; };
  return { fetcher, calls: () => calls };
}
function recordingRejector(error: unknown) {
  let calls = 0;
  const fetcher = async () => { calls++; throw error; };
  return { fetcher, calls: () => calls };
}

test('loadPreview: a fresh key calls the fetcher and caches the result', async () => {
  __resetPreviewCacheForTest();
  const { fetcher, calls } = recordingFetcher('data:image/png;base64,AAA');
  const result = await loadPreview('tile:a@1.0.0', fetcher);
  assert.equal(result, 'data:image/png;base64,AAA');
  assert.equal(calls(), 1);
  assert.equal(peekPreview('tile:a@1.0.0'), 'data:image/png;base64,AAA');
});

test('loadPreview: a cache hit does not call the fetcher again', async () => {
  __resetPreviewCacheForTest();
  const key = 'tile:b@1.0.0';
  const first = recordingFetcher('data:image/png;base64,BBB');
  await loadPreview(key, first.fetcher);
  assert.equal(first.calls(), 1);

  // A second, independent fetcher for the SAME key — if the cache hit didn't
  // short-circuit, this one would be the one that got called.
  const second = recordingFetcher('data:image/png;base64,SHOULD_NOT_BE_USED');
  const result = await loadPreview(key, second.fetcher);
  assert.equal(result, 'data:image/png;base64,BBB'); // the original, cached value
  assert.equal(second.calls(), 0); // never invoked — the call counter, not just the value, proves this
});

test('loadPreview: a rejecting fetcher caches null, and is not retried for the same key', async () => {
  __resetPreviewCacheForTest();
  const key = 'visualizer:c@2.0.0';
  const first = recordingRejector(new Error('404'));
  const result1 = await loadPreview(key, first.fetcher);
  assert.equal(result1, null);
  assert.equal(first.calls(), 1);
  assert.equal(peekPreview(key), null); // recorded as null, not absent — "asked once"

  const second = recordingFetcher('data:image/png;base64,SHOULD_NOT_BE_USED');
  const result2 = await loadPreview(key, second.fetcher);
  assert.equal(result2, null);
  assert.equal(second.calls(), 0);
});

test('loadPreview: two concurrent calls for the same key invoke the fetcher once and both resolve to the same value', async () => {
  __resetPreviewCacheForTest();
  const key = 'tile:d@1.0.0';
  const { fetcher, calls } = recordingFetcher('data:image/png;base64,DDD');

  // Fired back-to-back, neither awaited yet — this is the exact shape of
  // React 18 StrictMode's double-effect that caused the live bug: two
  // "is this cached yet?" checks racing before either write lands.
  const p1 = loadPreview(key, fetcher);
  const p2 = loadPreview(key, fetcher);
  const [r1, r2] = await Promise.all([p1, p2]);

  assert.equal(calls(), 1); // the regression this task's live testing caught
  assert.equal(r1, 'data:image/png;base64,DDD');
  assert.equal(r2, 'data:image/png;base64,DDD');
});

test('loadPreview: the in-flight entry is cleared on both resolve and reject, so a reset key can be re-driven', async () => {
  __resetPreviewCacheForTest();
  const key = 'tile:e@1.0.0';

  // Resolve path: fetcher #1 succeeds, then a reset clears the durable
  // cache. If the in-flight entry hadn't been cleared on resolve, this next
  // call would find a stale settled promise instead of calling fetcher #2.
  const ok = recordingFetcher('data:image/png;base64,EEE');
  await loadPreview(key, ok.fetcher);
  __resetPreviewCacheForTest();
  const ok2 = recordingFetcher('data:image/png;base64,EEE2');
  const afterResolveReset = await loadPreview(key, ok2.fetcher);
  assert.equal(afterResolveReset, 'data:image/png;base64,EEE2');
  assert.equal(ok2.calls(), 1);

  // Reject path: same proof, but the first fetcher fails instead.
  __resetPreviewCacheForTest();
  const bad = recordingRejector(new Error('fail'));
  await loadPreview(key, bad.fetcher);
  __resetPreviewCacheForTest();
  const good = recordingFetcher('data:image/png;base64,EEE3');
  const afterRejectReset = await loadPreview(key, good.fetcher);
  assert.equal(afterRejectReset, 'data:image/png;base64,EEE3');
  assert.equal(good.calls(), 1);
});

test('peekPreview: undefined for a never-attempted key, distinct from a recorded null failure', () => {
  __resetPreviewCacheForTest();
  assert.equal(peekPreview('tile:never-asked@1.0.0'), undefined);
});
