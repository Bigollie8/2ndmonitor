import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatClock, formatDateLine, parseDateTimeConfig, systemHour12 } from './dateTime';

// 2026-08-03T14:05:09Z — a Monday.
const TS = Date.UTC(2026, 7, 3, 14, 5, 9);

/** ICU ≥72 uses U+202F before the dayPeriod; older uses a plain space. */
const norm = (s: string) => s.replace(/\u202f/g, ' ');

test('formatClock: 24-hour, no seconds', () => {
  assert.equal(formatClock(TS, { hour12: false, locale: 'en-US', timeZone: 'UTC' }), '14:05');
});

test('formatClock: 24-hour with seconds', () => {
  assert.equal(
    formatClock(TS, { hour12: false, seconds: true, locale: 'en-US', timeZone: 'UTC' }),
    '14:05:09',
  );
});

test('formatClock: 12-hour', () => {
  assert.equal(norm(formatClock(TS, { hour12: true, locale: 'en-US', timeZone: 'UTC' })), '2:05 PM');
});

test('formatDateLine: full weekday + month + day (en-US)', () => {
  assert.equal(formatDateLine(TS, 'en-US', 'UTC'), 'Monday, August 3');
});

test('formatDateLine: honors other locales (de-DE)', () => {
  assert.equal(formatDateLine(TS, 'de-DE', 'UTC'), 'Montag, 3. August');
});

test('systemHour12: en-US prefers 12-hour, de-DE prefers 24-hour', () => {
  assert.equal(systemHour12('en-US'), true);
  assert.equal(systemHour12('de-DE'), false);
});

test('parseDateTimeConfig: fallback on garbage', () => {
  const fallback = { style: 'digital', seconds: false };
  assert.deepEqual(parseDateTimeConfig(undefined), fallback);
  assert.deepEqual(parseDateTimeConfig(null), fallback);
  assert.deepEqual(parseDateTimeConfig('digital'), fallback);
  assert.deepEqual(parseDateTimeConfig({ style: 'analog', seconds: true }), fallback);
  assert.deepEqual(parseDateTimeConfig({ seconds: 'yes' }), fallback);
});

test('parseDateTimeConfig: valid configs', () => {
  assert.deepEqual(parseDateTimeConfig({ style: 'digital', seconds: true }), { style: 'digital', seconds: true });
  assert.deepEqual(parseDateTimeConfig({ seconds: true }), { style: 'digital', seconds: true });
  assert.deepEqual(parseDateTimeConfig({}), { style: 'digital', seconds: false });
});
