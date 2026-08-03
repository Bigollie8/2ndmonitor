import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sourceKey, parseSourceKey, effectiveSensitivity, migrateSensitivity,
  migrateAudioSource, describeAudioSource, toggleAppInSource,
  DEFAULT_SENSITIVITY, MAX_AUDIO_APPS,
} from './audioSource';
import type { AudioSource } from './audioSource';

// ---------------------------------------------------------------------------
// sourceKey / parseSourceKey
// ---------------------------------------------------------------------------

test('sourceKey: mix is "mix"; apps sort the exes and join with +', () => {
  assert.equal(sourceKey({ mode: 'mix' }), 'mix');
  assert.equal(sourceKey({ mode: 'apps', exes: ['spotify.exe'] }), 'apps:spotify.exe');
  assert.equal(
    sourceKey({ mode: 'apps', exes: ['spotify.exe', 'discord.exe'] }),
    'apps:discord.exe+spotify.exe',
  );
});

test('sourceKey: the same set in any pick order resolves the same key', () => {
  assert.equal(
    sourceKey({ mode: 'apps', exes: ['b.exe', 'a.exe'] }),
    sourceKey({ mode: 'apps', exes: ['a.exe', 'b.exe'] }),
  );
});

test('parseSourceKey round-trips sorted sources', () => {
  for (const s of [
    { mode: 'mix' },
    { mode: 'apps', exes: ['a.exe'] },
    { mode: 'apps', exes: ['a.exe', 'b.exe'] },
  ] as AudioSource[]) {
    assert.deepEqual(parseSourceKey(sourceKey(s)), s);
  }
});

test('parseSourceKey: junk and the retired 0.6.4 key formats degrade to mix', () => {
  assert.deepEqual(parseSourceKey(''), { mode: 'mix' });
  assert.deepEqual(parseSourceKey('apps:'), { mode: 'mix' });
  assert.deepEqual(parseSourceKey('garbage'), { mode: 'mix' });
  assert.deepEqual(parseSourceKey('only:spotify.exe'), { mode: 'mix' });
  assert.deepEqual(parseSourceKey('except:discord.exe'), { mode: 'mix' });
});

// ---------------------------------------------------------------------------
// migrateAudioSource — the 0.6.4 → 0.6.6 source migration
// ---------------------------------------------------------------------------

test('migrateAudioSource: 0.6.4 only:<exe> becomes a one-app include list', () => {
  assert.deepEqual(
    migrateAudioSource({ mode: 'only', exe: 'Spotify.EXE' }),
    { mode: 'apps', exes: ['spotify.exe'] },
  );
});

test('migrateAudioSource: 0.6.4 except:<exe> has no equivalent and becomes mix', () => {
  assert.deepEqual(migrateAudioSource({ mode: 'except', exe: 'discord.exe' }), { mode: 'mix' });
});

test('migrateAudioSource: current shapes pass through, normalized', () => {
  assert.deepEqual(migrateAudioSource({ mode: 'mix' }), { mode: 'mix' });
  assert.deepEqual(
    migrateAudioSource({ mode: 'apps', exes: ['A.EXE', 'a.exe', 'b.exe'] }),
    { mode: 'apps', exes: ['a.exe', 'b.exe'] },
  );
});

test('migrateAudioSource: the apps list is capped at MAX_AUDIO_APPS', () => {
  const exes = ['a.exe', 'b.exe', 'c.exe', 'd.exe', 'e.exe'];
  assert.deepEqual(
    migrateAudioSource({ mode: 'apps', exes }),
    { mode: 'apps', exes: exes.slice(0, MAX_AUDIO_APPS) },
  );
});

test('migrateAudioSource: junk becomes mix, not a crash', () => {
  for (const junk of [
    undefined, null, 'mix', 42, [],
    { mode: 'apps' }, { mode: 'apps', exes: [] }, { mode: 'apps', exes: [1, 2] },
    { mode: 'only' }, { mode: 'except' },
  ]) {
    assert.deepEqual(migrateAudioSource(junk), { mode: 'mix' });
  }
});

// ---------------------------------------------------------------------------
// toggleAppInSource — the one gesture both the picker rows and the mixer
// headphone button perform
// ---------------------------------------------------------------------------

test('toggleAppInSource: from mix, checking an app starts the set as [exe]', () => {
  assert.deepEqual(
    toggleAppInSource({ mode: 'mix' }, 'Spotify.exe'),
    { mode: 'apps', exes: ['spotify.exe'] },
  );
});

test('toggleAppInSource: unchecking the last member returns to mix', () => {
  assert.deepEqual(
    toggleAppInSource({ mode: 'apps', exes: ['spotify.exe'] }, 'spotify.exe'),
    { mode: 'mix' },
  );
});

test('toggleAppInSource: adds and removes membership, preserving order', () => {
  const two = toggleAppInSource({ mode: 'apps', exes: ['a.exe'] }, 'b.exe');
  assert.deepEqual(two, { mode: 'apps', exes: ['a.exe', 'b.exe'] });
  assert.deepEqual(toggleAppInSource(two, 'a.exe'), { mode: 'apps', exes: ['b.exe'] });
});

test('toggleAppInSource: adding a fifth app is an identity no-op', () => {
  const full: AudioSource = { mode: 'apps', exes: ['a.exe', 'b.exe', 'c.exe', 'd.exe'] };
  assert.equal(toggleAppInSource(full, 'e.exe'), full); // same object, not just equal
});

// ---------------------------------------------------------------------------
// effectiveSensitivity — unchanged behavior, new key format
// ---------------------------------------------------------------------------

test('effectiveSensitivity: falls back to the default when unset', () => {
  assert.equal(effectiveSensitivity({}, { mode: 'mix' }), DEFAULT_SENSITIVITY);
  assert.equal(effectiveSensitivity({ mix: 1.8 }, { mode: 'mix' }), 1.8);
});

test('effectiveSensitivity: an apps set finds its gain under the sorted key', () => {
  const map = { 'apps:discord.exe+spotify.exe': 2.2 };
  assert.equal(
    effectiveSensitivity(map, { mode: 'apps', exes: ['spotify.exe', 'discord.exe'] }),
    2.2,
  );
});

test('effectiveSensitivity: a malformed map (e.g. null from a bad import) falls back instead of throwing', () => {
  assert.equal(effectiveSensitivity(null as unknown as Record<string, number>, { mode: 'mix' }), DEFAULT_SENSITIVITY);
  assert.equal(effectiveSensitivity([1, 2] as unknown as Record<string, number>, { mode: 'apps', exes: ['a.exe'] }), DEFAULT_SENSITIVITY);
  assert.equal(effectiveSensitivity('nope' as unknown as Record<string, number>, { mode: 'mix' }), DEFAULT_SENSITIVITY);
});

// ---------------------------------------------------------------------------
// describeAudioSource — the status-bar truth
// ---------------------------------------------------------------------------

test('describeAudioSource: mix ignores the resolver and the live list', () => {
  assert.equal(
    describeAudioSource({ mode: 'mix' }, () => { throw new Error('should not be called'); }, null),
    'all system audio',
  );
});

test('describeAudioSource: apps join friendly names with " + " in exes order', () => {
  const nameOf = (exe: string) => (exe === 'spotify.exe' ? 'Spotify' : exe === 'discord.exe' ? 'Discord' : exe);
  assert.equal(
    describeAudioSource({ mode: 'apps', exes: ['spotify.exe', 'discord.exe'] }, nameOf, ['spotify.exe', 'discord.exe']),
    'Spotify + Discord',
  );
});

test('describeAudioSource: an exe absent from liveExes is annotated (not running)', () => {
  const nameOf = (exe: string) => (exe === 'spotify.exe' ? 'Spotify' : 'Discord');
  assert.equal(
    describeAudioSource({ mode: 'apps', exes: ['spotify.exe'] }, nameOf, []),
    'Spotify (not running)',
  );
  assert.equal(
    describeAudioSource({ mode: 'apps', exes: ['spotify.exe', 'discord.exe'] }, nameOf, ['spotify.exe']),
    'Spotify + Discord (not running)',
  );
});

test('describeAudioSource: liveExes null (backend state unknown) means no annotation', () => {
  assert.equal(
    describeAudioSource({ mode: 'apps', exes: ['spotify.exe'] }, () => 'Spotify', null),
    'Spotify',
  );
});

test('describeAudioSource: falls back to the exe when no friendly name resolves', () => {
  assert.equal(
    describeAudioSource({ mode: 'apps', exes: ['weird.exe'] }, (exe) => exe, null),
    'weird.exe',
  );
});

// ---------------------------------------------------------------------------
// migrateSensitivity — scalar fold-in + 0.6.4 key renames, idempotent
// ---------------------------------------------------------------------------

test('migrateSensitivity: an old scalar becomes the mix entry', () => {
  assert.deepEqual(migrateSensitivity(1.65), { mix: 1.65 });
});

test('migrateSensitivity: only: keys are respelled apps:, except: keys are dropped', () => {
  assert.deepEqual(
    migrateSensitivity({ mix: 1.0, 'only:spotify.exe': 1.5, 'except:discord.exe': 0.6 }),
    { mix: 1.0, 'apps:spotify.exe': 1.5 },
  );
});

test('migrateSensitivity: an existing apps: key wins over a stale only: twin', () => {
  assert.deepEqual(
    migrateSensitivity({ 'apps:spotify.exe': 2.0, 'only:spotify.exe': 1.5 }),
    { 'apps:spotify.exe': 2.0 },
  );
});

test('migrateSensitivity: a new-format map passes through unchanged (idempotent)', () => {
  const map = { mix: 1.0, 'apps:foo.exe': 1.5, 'apps:bar.exe+foo.exe': 0.9 };
  assert.deepEqual(migrateSensitivity(map), map);
  assert.deepEqual(migrateSensitivity(migrateSensitivity(map)), map);
});

test('migrateSensitivity: junk becomes an empty map, not a crash', () => {
  assert.deepEqual(migrateSensitivity(undefined), {});
  assert.deepEqual(migrateSensitivity(null), {});
  assert.deepEqual(migrateSensitivity('1.5'), {});
  assert.deepEqual(migrateSensitivity(Number.NaN), {});
});
