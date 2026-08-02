import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceKey, parseSourceKey, effectiveSensitivity, migrateSensitivity, describeAudioSource, DEFAULT_SENSITIVITY } from './audioSource';
import type { AudioSource } from './audioSource';

test('parseSourceKey round-trips every source shape', () => {
  for (const s of [{ mode: 'mix' }, { mode: 'only', exe: 'a.exe' }, { mode: 'except', exe: 'b.exe' }] as AudioSource[]) {
    assert.deepEqual(parseSourceKey(sourceKey(s)), s);
  }
});

test('sourceKey: mode is part of the key, not just the exe', () => {
  assert.equal(sourceKey({ mode: 'mix' }), 'mix');
  assert.equal(sourceKey({ mode: 'only', exe: 'spotify.exe' }), 'only:spotify.exe');
  assert.equal(sourceKey({ mode: 'except', exe: 'spotify.exe' }), 'except:spotify.exe');
});

test('effectiveSensitivity: falls back to the default when unset', () => {
  assert.equal(effectiveSensitivity({}, { mode: 'mix' }), DEFAULT_SENSITIVITY);
  assert.equal(effectiveSensitivity({ mix: 1.8 }, { mode: 'mix' }), 1.8);
});

test('effectiveSensitivity: only and except keep separate values for one app', () => {
  const map = { 'only:spotify.exe': 2.2, 'except:spotify.exe': 0.6 };
  assert.equal(effectiveSensitivity(map, { mode: 'only', exe: 'spotify.exe' }), 2.2);
  assert.equal(effectiveSensitivity(map, { mode: 'except', exe: 'spotify.exe' }), 0.6);
});

test('migrateSensitivity: an old scalar becomes the mix entry', () => {
  assert.deepEqual(migrateSensitivity(1.65), { mix: 1.65 });
});

test('migrateSensitivity: an existing map passes through unchanged', () => {
  const map = { mix: 1.0, 'only:foo.exe': 1.5 };
  assert.deepEqual(migrateSensitivity(map), map);
});

test('migrateSensitivity: junk becomes an empty map, not a crash', () => {
  assert.deepEqual(migrateSensitivity(undefined), {});
  assert.deepEqual(migrateSensitivity(null), {});
  assert.deepEqual(migrateSensitivity('1.5'), {});
  assert.deepEqual(migrateSensitivity(Number.NaN), {});
});

test('describeAudioSource: mix ignores the name resolver', () => {
  assert.equal(describeAudioSource({ mode: 'mix' }, () => { throw new Error('should not be called'); }), 'all system audio');
});

test('describeAudioSource: only/except use the resolved friendly name', () => {
  const nameOf = (exe: string) => (exe === 'spotify.exe' ? 'Spotify' : exe);
  assert.equal(describeAudioSource({ mode: 'only', exe: 'spotify.exe' }, nameOf), 'only Spotify');
  assert.equal(describeAudioSource({ mode: 'except', exe: 'discord.exe' }, nameOf), 'except discord.exe');
});
