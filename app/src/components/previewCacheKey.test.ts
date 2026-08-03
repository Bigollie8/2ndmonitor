import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewCacheKey } from './previewCacheKey';

test('previewCacheKey: same kind/id/version always produces the same key', () => {
  assert.equal(previewCacheKey('tile', 'tile-quote', '1.0.1'), previewCacheKey('tile', 'tile-quote', '1.0.1'));
});

test('previewCacheKey: a different kind produces a different key for the same id/version', () => {
  assert.notEqual(previewCacheKey('tile', 'orbit', '1.0.0'), previewCacheKey('visualizer', 'orbit', '1.0.0'));
});

test('previewCacheKey: a different version produces a different key — an update must refetch', () => {
  assert.notEqual(previewCacheKey('tile', 'tile-quote', '1.0.1'), previewCacheKey('tile', 'tile-quote', '1.0.2'));
});

test('previewCacheKey: format is kind:id@version#idx', () => {
  assert.equal(previewCacheKey('visualizer', 'orbit', '2.3.0'), 'visualizer:orbit@2.3.0#0');
});

test('an index distinguishes assets of the same bundle version', () => {
  assert.notEqual(
    previewCacheKey('tile', 'radar', '1.0.0', 0),
    previewCacheKey('tile', 'radar', '1.0.0', 1),
  );
});

test('omitting the index means asset 0, so existing call sites keep their keys', () => {
  assert.equal(previewCacheKey('tile', 'radar', '1.0.0'), previewCacheKey('tile', 'radar', '1.0.0', 0));
});

test('the key still distinguishes kind, id and version', () => {
  assert.notEqual(previewCacheKey('tile', 'a', '1.0.0', 0), previewCacheKey('visualizer', 'a', '1.0.0', 0));
  assert.notEqual(previewCacheKey('tile', 'a', '1.0.0', 0), previewCacheKey('tile', 'a', '1.1.0', 0));
});
