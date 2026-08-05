import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNewsConfig, headlineAge, DEFAULT_NEWS_CONFIG, NEWS_CATEGORIES } from './news';

test('parseNewsConfig: valid categories pass, everything else falls back', () => {
  for (const { id } of NEWS_CATEGORIES) {
    assert.deepEqual(parseNewsConfig({ category: id }), { category: id });
  }
  assert.deepEqual(parseNewsConfig(undefined), DEFAULT_NEWS_CONFIG);
  assert.deepEqual(parseNewsConfig(null), DEFAULT_NEWS_CONFIG);
  assert.deepEqual(parseNewsConfig('sports'), DEFAULT_NEWS_CONFIG);
  assert.deepEqual(parseNewsConfig({ category: 'crypto' }), DEFAULT_NEWS_CONFIG);
  assert.deepEqual(parseNewsConfig({ category: 7 }), DEFAULT_NEWS_CONFIG);
});

test('parseNewsConfig: tolerates shared config keys in the same blob', () => {
  // instance.config is shared storage — a mapView key from some future change
  // must not break the parse (the parseRadarConfig lesson).
  assert.deepEqual(parseNewsConfig({ category: 'sports', mapView: { x: 1 } }), { category: 'sports' });
});

test('headlineAge: RFC 2822 pubDate → compact age', () => {
  const now = Date.parse('Tue, 05 Aug 2026 12:00:00 GMT');
  assert.equal(headlineAge('Tue, 05 Aug 2026 11:58:30 GMT', now), '1m');
  assert.equal(headlineAge('Tue, 05 Aug 2026 09:00:00 GMT', now), '3h');
  assert.equal(headlineAge('Sun, 02 Aug 2026 12:00:00 GMT', now), '3d');
  assert.equal(headlineAge('Tue, 05 Aug 2026 11:59:59 GMT', now), 'now');
});

test('headlineAge: unknown, garbage, and future dates never mislead', () => {
  const now = Date.parse('Tue, 05 Aug 2026 12:00:00 GMT');
  assert.equal(headlineAge(null, now), null);
  assert.equal(headlineAge('yesterday-ish', now), null);
  // Clock skew: a feed stamped slightly ahead reads as "now", never "-3m".
  assert.equal(headlineAge('Tue, 05 Aug 2026 12:03:00 GMT', now), 'now');
});
