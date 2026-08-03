import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatClock, formatDateLine, parseDateTimeConfig, systemHour12, resolveHour12, formatClockParts, formatHourLabel, handAngles } from './dateTime';

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
  assert.deepEqual(parseDateTimeConfig({ style: 'wooden', seconds: true }), { style: 'digital', seconds: true });
  assert.deepEqual(parseDateTimeConfig({ seconds: 'yes' }), fallback);
});

test('parseDateTimeConfig: valid configs', () => {
  assert.deepEqual(parseDateTimeConfig({ style: 'digital', seconds: true }), { style: 'digital', seconds: true });
  assert.deepEqual(parseDateTimeConfig({ seconds: true }), { style: 'digital', seconds: true });
  assert.deepEqual(parseDateTimeConfig({}), { style: 'digital', seconds: false });
});

test('resolveHour12: explicit settings win, system defers to locale', () => {
  assert.equal(resolveHour12('12h', 'de-DE'), true);
  assert.equal(resolveHour12('24h', 'en-US'), false);
  assert.equal(resolveHour12('system', 'en-US'), true);
  assert.equal(resolveHour12('system', 'de-DE'), false);
});

test('formatClockParts: splits hm from the day period', () => {
  const p24 = formatClockParts(TS, { hour12: false, locale: 'en-US', timeZone: 'UTC' });
  assert.equal(p24.hm, '14:05');
  assert.equal(p24.dayPeriod, null);
  const p12 = formatClockParts(TS, { hour12: true, locale: 'en-US', timeZone: 'UTC' });
  assert.equal(p12.hm, '2:05');
  assert.equal(p12.dayPeriod, 'PM');
});

test('formatHourLabel: 12h matches the Rust "8p" shape, 24h zero-pads', () => {
  assert.equal(formatHourLabel(0, true), '12a');
  assert.equal(formatHourLabel(8, true), '8a');
  assert.equal(formatHourLabel(12, true), '12p');
  assert.equal(formatHourLabel(20, true), '8p');
  assert.equal(formatHourLabel(8, false), '08');
  assert.equal(formatHourLabel(20, false), '20');
  assert.equal(formatHourLabel(0, false), '00');
});

test('parseDateTimeConfig: all three styles are valid (0.7.2 §4)', () => {
  assert.deepEqual(parseDateTimeConfig({ style: 'minimal' }), { style: 'minimal', seconds: false });
  assert.deepEqual(parseDateTimeConfig({ style: 'analog', seconds: true }), { style: 'analog', seconds: true });
  assert.deepEqual(parseDateTimeConfig({ style: 'digital', seconds: true }), { style: 'digital', seconds: true });
});

test('handAngles: hand math at fixed instants (UTC)', () => {
  // 03:00:00 → hour hand at 90°, others at 0
  assert.deepEqual(handAngles(Date.UTC(2026, 0, 1, 3, 0, 0), 'UTC'), { hour: 90, minute: 0, second: 0 });
  // 12:00:00 → all hands at 12
  assert.deepEqual(handAngles(Date.UTC(2026, 0, 1, 12, 0, 0), 'UTC'), { hour: 0, minute: 0, second: 0 });
  // 18:30:15 → hour 6*30 + 30*0.5 = 195; minute 30*6 + 15*0.1 = 181.5; second 90
  assert.deepEqual(handAngles(Date.UTC(2026, 0, 1, 18, 30, 15), 'UTC'), { hour: 195, minute: 181.5, second: 90 });
  // midnight → hour 0 (h23 cycle, never 24)
  assert.deepEqual(handAngles(Date.UTC(2026, 0, 1, 0, 0, 0), 'UTC'), { hour: 0, minute: 0, second: 0 });
});
