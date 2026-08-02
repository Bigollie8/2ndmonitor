import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldPrompt, SNOOZE_MS, type UpdaterPromptState } from './updater';

const base: UpdaterPromptState = {
  currentVersion: '0.5.1',
  offeredVersion: '0.5.2',
  promptedThisSession: null,
  snoozedVersion: null,
  snoozedUntil: null,
};
const NOW = 1_754_000_000_000;

test('shouldPrompt: a newly offered newer version prompts', () => {
  assert.equal(shouldPrompt(base, NOW), true);
});

test('shouldPrompt: nothing offered, no prompt', () => {
  assert.equal(shouldPrompt({ ...base, offeredVersion: null }, NOW), false);
});

test('shouldPrompt: the running version is never offered back', () => {
  assert.equal(shouldPrompt({ ...base, offeredVersion: '0.5.1' }, NOW), false);
});

test('shouldPrompt: at most once per version per session', () => {
  assert.equal(shouldPrompt({ ...base, promptedThisSession: '0.5.2' }, NOW), false);
});

test('shouldPrompt: a session prompt for an OLDER version does not mute a newer one', () => {
  assert.equal(shouldPrompt({ ...base, promptedThisSession: '0.5.1' }, NOW), true);
});

test('shouldPrompt: active snooze mutes the snoozed version', () => {
  const s = { ...base, snoozedVersion: '0.5.2', snoozedUntil: NOW + 1000 };
  assert.equal(shouldPrompt(s, NOW), false);
});

test('shouldPrompt: expired snooze prompts again', () => {
  const s = { ...base, snoozedVersion: '0.5.2', snoozedUntil: NOW - 1 };
  assert.equal(shouldPrompt(s, NOW), true);
});

test('shouldPrompt: snooze of an older version does not mute a newer offer', () => {
  const s = { ...base, snoozedVersion: '0.5.2', snoozedUntil: NOW + SNOOZE_MS, offeredVersion: '0.5.3' };
  assert.equal(shouldPrompt(s, NOW), true);
});
