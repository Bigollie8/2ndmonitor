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

test('backoffDelay: clamps to the int32 setTimeout ceiling (I3)', () => {
  // The review finding's own example: "~25 days", which used to pass both
  // validators and would degenerate setTimeout's delay to 0 uncapped.
  assert.equal(backoffDelay(2_200_000_000, 0), 2_147_483_647);
  // A validator-capped 24h interval backed off 8x (691.2e6ms) stays well
  // under the ceiling and is returned untouched.
  assert.equal(backoffDelay(86_400_000, 3), 691_200_000);
  // Directly at the ceiling: passes through unchanged.
  assert.equal(backoffDelay(2_147_483_647, 0), 2_147_483_647);
});
