import test from 'node:test';
import assert from 'node:assert/strict';
import { cacheKeyFor, readCachedIndex, writeCachedIndex, clearCachedIndex } from './indexCache';

// Minimal localStorage stand-in: these tests run in node, not a browser.
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
};

test('cacheKeyFor namespaces by server URL', () => {
  assert.notEqual(cacheKeyFor('https://a.example'), cacheKeyFor('https://b.example'));
});

test('a cached body round-trips', () => {
  store.clear();
  writeCachedIndex('{"bundles":[],"sig":"x"}', 'https://a.example');
  assert.equal(readCachedIndex('https://a.example'), '{"bundles":[],"sig":"x"}');
});

test('a body cached for one server is not returned for another', () => {
  // Pointing the app at a different marketplace must not surface the old
  // server's catalog -- the pinned signing key differs, so it would fail
  // verification anyway, but returning it at all is the wrong answer.
  store.clear();
  writeCachedIndex('{"bundles":[]}', 'https://a.example');
  assert.equal(readCachedIndex('https://b.example'), null);
});

test('reading with no cache returns null rather than throwing', () => {
  store.clear();
  assert.equal(readCachedIndex('https://a.example'), null);
});

test('clearCachedIndex removes only that server\'s entry', () => {
  store.clear();
  writeCachedIndex('a', 'https://a.example');
  writeCachedIndex('b', 'https://b.example');
  clearCachedIndex('https://a.example');
  assert.equal(readCachedIndex('https://a.example'), null);
  assert.equal(readCachedIndex('https://b.example'), 'b');
});

test('an oversized body is not cached, so localStorage cannot be filled', () => {
  store.clear();
  writeCachedIndex('x'.repeat(3_000_000), 'https://a.example');
  assert.equal(readCachedIndex('https://a.example'), null);
});
