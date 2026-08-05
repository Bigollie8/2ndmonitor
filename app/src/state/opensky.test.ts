import test from 'node:test';
import assert from 'node:assert/strict';
import { describeAircraftError, AIRCRAFT_REFRESH_MS } from './opensky';

test('describeAircraftError: a 429 is the daily anonymous quota, not a blip', () => {
  const d = describeAircraftError('OpenSky HTTP 429: Too many requests');
  assert.equal(d.rateLimited, true);
  // Must NOT promise a quick recovery - the old copy said "usually clears in a
  // minute", which is wrong for a daily quota and is what made this look like
  // a transient API fault rather than a budget we had exhausted.
  assert.match(d.hint, /daily/i);
  assert.doesNotMatch(d.hint, /minute/i);
});

test('describeAircraftError: other HTTP errors are not treated as rate limits', () => {
  for (const msg of ['OpenSky HTTP 503: upstream down', 'OpenSky HTTP 500: boom']) {
    const d = describeAircraftError(msg);
    assert.equal(d.rateLimited, false, msg);
  }
});

test('describeAircraftError: network and parse failures pass through', () => {
  const net = describeAircraftError('network: connection refused');
  assert.equal(net.rateLimited, false);
  assert.match(net.label, /unavailable|error/i);

  const parse = describeAircraftError('parse: expected value');
  assert.equal(parse.rateLimited, false);
});

test('describeAircraftError: null means no error', () => {
  assert.equal(describeAircraftError(null), null);
});

test('AIRCRAFT_REFRESH_MS stays inside the anonymous OpenSky daily budget', () => {
  const perDay = (24 * 60 * 60 * 1000) / AIRCRAFT_REFRESH_MS;
  // Anonymous OpenSky allows a few hundred credits/day. The 60s interval this
  // replaced was 1440/day, which exhausted the budget in hours and then 429ed
  // for the rest of the day. Keep a wide margin - a bbox can cost >1 credit.
  assert.ok(perDay <= 300, `${perDay} requests/day is over the anonymous budget`);
  // Sanity: not so slow the tile feels dead.
  assert.ok(AIRCRAFT_REFRESH_MS <= 10 * 60 * 1000);
});
