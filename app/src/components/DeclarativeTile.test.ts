import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseResponseBody } from './DeclarativeTile';

// ─── parseResponseBody ───────────────────────────────────────────────────────
//
// An empty 200 body is the common case for e.g. an ntfy topic with no new
// messages (tile-phonenotifs) — it is not malformed JSON, it's the absence
// of data, and must resolve to `null` so the existing `data == null ->
// TileEmpty` path handles it instead of a raw parse-error TileError.

test('parseResponseBody: empty body resolves to null, not a parse error', () => {
  assert.equal(parseResponseBody(''), null);
});

test('parseResponseBody: whitespace-only body resolves to null', () => {
  assert.equal(parseResponseBody('   \n'), null);
  assert.equal(parseResponseBody('\r\n'), null);
});

test('parseResponseBody: valid JSON is parsed normally', () => {
  assert.deepEqual(parseResponseBody('{"a":1}'), { a: 1 });
  assert.deepEqual(parseResponseBody('[1,2,3]'), [1, 2, 3]);
  assert.equal(parseResponseBody('null'), null);
});

test('parseResponseBody: non-empty invalid JSON still throws', () => {
  assert.throws(
    () => parseResponseBody('not json'),
    /response body was not valid JSON/,
  );
});
