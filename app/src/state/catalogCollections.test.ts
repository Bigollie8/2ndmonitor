import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseCollections } from './catalogCollections';
import { buildShelves } from './catalogShelves';

const coll = (slug: string, items: string[] = ['a']) => ({
  slug, title: `T-${slug}`, blurb: null, items,
});

// THE regression. The server answers with an envelope; the client typed the
// result as a bare array and iterated it, which threw during render and
// black-screened the whole Market. Twice.
test('the {collections: [...]} envelope is unwrapped', () => {
  const got = normaliseCollections({ collections: [coll('featured')] });
  assert.equal(got.length, 1);
  assert.equal(got[0].slug, 'featured');
});

test('a bare array still works, so either server shape is safe', () => {
  assert.equal(normaliseCollections([coll('x')]).length, 1);
});

test('anything else yields an empty list rather than throwing', () => {
  for (const junk of [null, undefined, 42, 'nope', {}, { collections: 'no' }, { collections: null }]) {
    assert.deepEqual(normaliseCollections(junk), [], `${JSON.stringify(junk)}`);
  }
});

test('malformed entries are dropped, not repaired', () => {
  const got = normaliseCollections({
    collections: [
      coll('good'),
      { slug: '', title: 'no slug', blurb: null, items: [] },
      { slug: 'no-title', blurb: null, items: [] },
      { slug: 'no-items', title: 'x', blurb: null },
      null,
      'string',
    ],
  });
  assert.deepEqual(got.map((c) => c.slug), ['good']);
});

test('non-string ids inside a collection are filtered out', () => {
  const got = normaliseCollections({
    collections: [{ slug: 's', title: 't', blurb: null, items: ['a', 1, null, 'b'] }],
  });
  assert.deepEqual(got[0].items, ['a', 'b']);
});

// Defence in depth: even if a caller skips the normaliser, rendering must not
// throw. A throw here costs the entire store; an empty list costs a few
// shelves.
test('buildShelves survives a non-array collections argument', () => {
  const args = {
    items: [],
    dates: {},
    nowSec: 1_800_000_000,
    appVersion: '0.9.0',
  };
  assert.doesNotThrow(() => buildShelves({
    ...args,
    collections: { collections: [] } as never,
  }));
  assert.doesNotThrow(() => buildShelves({ ...args, collections: null as never }));
  assert.doesNotThrow(() => buildShelves({ ...args, collections: undefined as never }));
});
