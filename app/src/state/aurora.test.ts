import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  moonPhase,
  auroraVisibility,
  parseKpResponse,
  parseKpForecastResponse,
} from './aurora';

test('moonPhase: known new moon (2026-04-17 ~21:52 UTC)', () => {
  // April 17 2026 is a new moon. Conway algorithm gives phase ≈ 0 (or near 1).
  const d = new Date(Date.UTC(2026, 3, 17, 22, 0, 0));
  const r = moonPhase(d);
  // Phase 0 or close to 1 (cyclic). Either way illumination should be very low.
  assert.ok(r.illumination < 0.05, `expected new moon illumination near 0, got ${r.illumination}`);
});

test('moonPhase: known full moon (2026-05-01 ~09:25 UTC)', () => {
  // May 1 2026 is approximately a full moon.
  const d = new Date(Date.UTC(2026, 4, 1, 10, 0, 0));
  const r = moonPhase(d);
  assert.ok(r.illumination > 0.95, `expected full moon illumination near 1, got ${r.illumination}`);
});

test('moonPhase: returns name for canonical phases', () => {
  // Just verify the function returns a non-empty string for some date.
  const r = moonPhase(new Date(Date.UTC(2026, 5, 15, 12, 0, 0)));
  assert.ok(typeof r.name === 'string' && r.name.length > 0);
  assert.ok(r.phase >= 0 && r.phase < 1);
  assert.ok(r.illumination >= 0 && r.illumination <= 1);
});

test('auroraVisibility: low KP at low latitude → not visible', () => {
  assert.equal(auroraVisibility(2, 30), 'unlikely');
});

test('auroraVisibility: high KP at high latitude → visible', () => {
  assert.equal(auroraVisibility(7, 60), 'overhead');
});

test('auroraVisibility: KP 5 at 50N → northern horizon', () => {
  // KP 5 = G1 storm; aurora visible to ~50N latitude on northern horizon.
  const result = auroraVisibility(5, 50);
  assert.ok(result === 'horizon' || result === 'overhead',
    `expected horizon or overhead, got ${result}`);
});

test('parseKpResponse: extracts KP values from NOAA array format', () => {
  // NOAA returns array-of-arrays: [headers, ...rows]
  const fixture = [
    ['time_tag', 'Kp', 'a_running', 'station_count'],
    ['2026-05-07 00:00:00', '3.00', '15', '8'],
    ['2026-05-07 03:00:00', '4.33', '20', '8'],
  ];
  const out = parseKpResponse(fixture);
  assert.equal(out.length, 2);
  assert.equal(out[0]?.kp, 3.00);
  assert.equal(out[1]?.kp, 4.33);
});

test('parseKpForecastResponse: extracts forecast entries', () => {
  // Forecast format is similar but includes a "observed_or_estimated" column.
  const fixture = [
    ['time_tag', 'kp', 'observed', 'noaa_scale'],
    ['2026-05-07 12:00:00', '4.0', 'predicted', 'G0'],
    ['2026-05-07 15:00:00', '5.33', 'predicted', 'G1'],
  ];
  const out = parseKpForecastResponse(fixture);
  assert.equal(out.length, 2);
  assert.equal(out[0]?.kp, 4.0);
  assert.equal(out[1]?.kp, 5.33);
});
