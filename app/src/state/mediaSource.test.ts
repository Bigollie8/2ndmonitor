import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mediaSourceFor } from './mediaSource';

test('mediaSourceFor: null/undefined/empty all resolve to "none"', () => {
  for (const v of [null, undefined, '']) {
    assert.equal(mediaSourceFor(v).kind, 'none');
  }
});

test('mediaSourceFor: Windows AUMIDs resolve by case-insensitive substring', () => {
  assert.equal(mediaSourceFor('Spotify.exe').kind, 'spotify');
  assert.equal(mediaSourceFor('SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify').kind, 'spotify');
  assert.equal(mediaSourceFor('AppleInc.AppleMusicWin_nzyj5cx40ttqa!App').kind, 'appleMusic');
  assert.equal(mediaSourceFor('chrome.exe').kind, 'browser');
  assert.equal(mediaSourceFor('msedge.exe').kind, 'browser');
  assert.equal(mediaSourceFor('vlc.exe').kind, 'vlc');
});

test('mediaSourceFor: macOS bundle ids resolve to the same kinds as their Windows counterparts', () => {
  assert.equal(mediaSourceFor('com.spotify.client').kind, 'spotify');
  assert.equal(mediaSourceFor('com.apple.Music').kind, 'appleMusic');
  assert.equal(mediaSourceFor('com.google.Chrome').kind, 'browser');
  assert.equal(mediaSourceFor('com.apple.Safari').kind, 'browser');
  assert.equal(mediaSourceFor('com.microsoft.edgemac').kind, 'browser');
});

test('mediaSourceFor: bundle id matching is case-insensitive, like the AUMID case', () => {
  assert.equal(mediaSourceFor('COM.SPOTIFY.CLIENT').kind, 'spotify');
  assert.equal(mediaSourceFor('com.apple.music').kind, 'appleMusic');
});

test('mediaSourceFor: an unrecognized source falls back to "other" with a cleaned label', () => {
  const info = mediaSourceFor('SomeRandomApp.exe');
  assert.equal(info.kind, 'other');
  assert.equal(info.label, 'SomeRandomApp');
});

test('mediaSourceFor: an unrecognized macOS bundle id falls back to "other" without crashing', () => {
  const info = mediaSourceFor('com.example.unknownapp');
  assert.equal(info.kind, 'other');
  assert.ok(info.label.length > 0);
});
