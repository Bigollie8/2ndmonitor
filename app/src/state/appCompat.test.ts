import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, isNewer, isCompatible } from './appCompat';

test('compareVersions orders dotted numeric versions', () => {
  assert.ok(compareVersions('1.0.0', '1.0.1') < 0);
  assert.ok(compareVersions('1.2.0', '1.10.0') < 0, '10 must beat 2, not sort as a string');
  assert.equal(compareVersions('2.0.0', '2.0.0'), 0);
  assert.ok(compareVersions('2.0', '1.9.9') > 0);
});

test('compareVersions treats missing segments as zero', () => {
  assert.equal(compareVersions('1.0', '1.0.0'), 0);
  assert.ok(compareVersions('1.0.1', '1.0') > 0);
});

test('compareVersions treats non-numeric segments as zero, so a malformed version never wins', () => {
  assert.equal(compareVersions('next', '0.0.0'), 0);
  assert.ok(compareVersions('1.0.0', 'garbage') > 0);
});

test('isNewer reports an update only when available really is greater', () => {
  assert.equal(isNewer('1.1.0', '1.0.0'), true);
  assert.equal(isNewer('1.0.0', '1.0.0'), false);
  assert.equal(isNewer('0.9.0', '1.0.0'), false);
  // Failing closed matters: a spurious update badge invites a pointless install.
  assert.equal(isNewer('garbage', '1.0.0'), false);
});

test('isCompatible: no declared floor means compatible with anything', () => {
  assert.equal(isCompatible(null, '0.8.0'), true);
  assert.equal(isCompatible('', '0.8.0'), true);
});

test('isCompatible: the app must be at or above the declared floor', () => {
  assert.equal(isCompatible('0.8.0', '0.8.0'), true);
  assert.equal(isCompatible('0.8.0', '0.8.1'), true);
  assert.equal(isCompatible('0.9.0', '0.8.1'), false);
});

test('isCompatible: a malformed floor is treated as no floor, never as a block', () => {
  // Failing OPEN here, unlike isNewer's fail-closed: refusing to install
  // because a publisher typo'd their floor would be worse than allowing an
  // install the bundle might handle fine.
  assert.equal(isCompatible('next-release', '0.8.0'), true);
});
