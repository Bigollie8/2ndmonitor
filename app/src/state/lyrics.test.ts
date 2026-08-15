import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackKeyOf, parseLrc, currentLineIndex } from './lyrics';

// ── 0.9.7: stale-lyrics gate ────────────────────────────────────────────────

test('trackKeyOf mirrors the Rust artist|title|album key, trimmed', () => {
  assert.equal(
    trackKeyOf({ title: ' Weightless ', artist: ' Aphex ', album: ' Album ' }),
    'Aphex|Weightless|Album',
  );
  assert.equal(trackKeyOf({ title: 'Solo' }), '|Solo|');
});

test('trackKeyOf is null with no meaningful title — no track, no match, no overlay', () => {
  assert.equal(trackKeyOf(null), null);
  assert.equal(trackKeyOf(undefined), null);
  assert.equal(trackKeyOf({ title: '' }), null);
  assert.equal(trackKeyOf({ title: '   ', artist: 'X' }), null);
});

test('a video session key never matches a cached song key', () => {
  // The Netflix-in-Firefox case: GSMTC reports the video title; the store
  // still holds the last SONG's lyrics under its own key.
  const cachedSongKey = trackKeyOf({ title: 'Song', artist: 'Artist', album: 'LP' });
  const videoKey = trackKeyOf({ title: 'Stranger Things S4E1', artist: '', album: '' });
  assert.ok(cachedSongKey && videoKey);
  assert.notEqual(cachedSongKey, videoKey);
});

// Sanity coverage for the pure helpers this module already exposed.

test('parseLrc handles multi-timestamp lines and drops tag lines', () => {
  const lines = parseLrc('[ar:X]\n[00:01.50][00:30.00]chorus\n[00:10.00]verse');
  assert.deepEqual(lines.map((l) => l.tsMs), [1500, 10000, 30000]);
});

test('currentLineIndex finds the active line', () => {
  const lines = parseLrc('[00:05.00]a\n[00:10.00]b');
  assert.equal(currentLineIndex(lines, 4), -1);
  assert.equal(currentLineIndex(lines, 6), 0);
  assert.equal(currentLineIndex(lines, 11), 1);
});
