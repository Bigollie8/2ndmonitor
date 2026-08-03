import { test } from 'node:test';
import assert from 'node:assert/strict';

import { redactLocation, REDACTED_TEXT } from './streamer';

test('redactLocation: masks when on', () => {
  assert.equal(redactLocation('Knoxville, TN', true), '•••');
  assert.equal(redactLocation('Knoxville, TN', true), REDACTED_TEXT);
});

test('redactLocation: passthrough when off', () => {
  assert.equal(redactLocation('Knoxville, TN', false), 'Knoxville, TN');
  assert.equal(redactLocation('', false), '');
});

test('redactLocation: empty text still masks when on', () => {
  assert.equal(redactLocation('', true), REDACTED_TEXT);
});
