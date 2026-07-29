import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backoffDelay } from './usePoll';

test('backoffDelay: no failures -> base interval', () => {
  assert.equal(backoffDelay(30_000, 0), 30_000);
});

test('backoffDelay: doubles per consecutive failure', () => {
  assert.equal(backoffDelay(30_000, 1), 60_000);
  assert.equal(backoffDelay(30_000, 2), 120_000);
  assert.equal(backoffDelay(30_000, 3), 240_000);
});

test('backoffDelay: caps at 8x base', () => {
  assert.equal(backoffDelay(30_000, 4), 240_000);
  assert.equal(backoffDelay(30_000, 50), 240_000);
});

test('backoffDelay: negative failures treated as zero', () => {
  assert.equal(backoffDelay(30_000, -1), 30_000);
});
