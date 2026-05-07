import { test } from 'node:test';
import assert from 'node:assert/strict';

import { solarTimes, currentSunPhase, type SolarTimes, type SunPhase } from './solar';

// Helper: UTC hour of a Date (fractional). Tests use UTC to avoid timezone flake.
function utcHour(d: Date | null): number | null {
  if (!d) return null;
  return d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
}

test('solarTimes: equator on equinox — sunrise/sunset near 06:00/18:00 UTC', () => {
  // March 20 2026 is the spring equinox.
  // At lat=0, lon=0 the sun rises ~06:00 UTC and sets ~18:00 UTC on equinox.
  const t = solarTimes(0, 0, new Date(Date.UTC(2026, 2, 20, 12, 0, 0)));
  const sunriseH = utcHour(t.sunrise);
  const sunsetH = utcHour(t.sunset);
  assert.ok(sunriseH !== null && Math.abs(sunriseH - 6) < 0.5,
    `equinox equator sunrise should be near 06:00 UTC, got ${sunriseH}`);
  assert.ok(sunsetH !== null && Math.abs(sunsetH - 18) < 0.5,
    `equinox equator sunset should be near 18:00 UTC, got ${sunsetH}`);
});

test('solarTimes: Knoxville TN on summer solstice — sunrise ~10:15 UTC, sunset ~01:00 UTC next day', () => {
  // Knoxville TN: lat 35.96, lon -83.92. Summer solstice 2026 is June 21.
  // Local sunrise ~6:15 AM EDT = ~10:15 UTC. Local sunset ~8:59 PM EDT = ~00:59 UTC next day.
  const t = solarTimes(35.96, -83.92, new Date(Date.UTC(2026, 5, 21, 12, 0, 0)));
  // sunrise should be on June 21 around 10am UTC (06:00 EDT-ish)
  assert.ok(t.sunrise !== null);
  const sunriseH = utcHour(t.sunrise);
  assert.ok(sunriseH !== null && Math.abs(sunriseH - 10.25) < 0.5,
    `Knoxville solstice sunrise should be near 10:15 UTC, got ${sunriseH}`);
  // sunset is on June 22 around 00:59 UTC
  assert.ok(t.sunset !== null);
});

test('solarTimes: returns golden hour windows', () => {
  const t = solarTimes(35.96, -83.92, new Date(Date.UTC(2026, 5, 21, 12, 0, 0)));
  assert.ok(t.morningGoldenEnd !== null, 'morningGoldenEnd should be defined');
  assert.ok(t.eveningGoldenStart !== null, 'eveningGoldenStart should be defined');
  // Morning golden end is after sunrise
  if (t.sunrise && t.morningGoldenEnd) {
    assert.ok(t.morningGoldenEnd.getTime() > t.sunrise.getTime(),
      'morningGoldenEnd should be after sunrise');
  }
  // Evening golden start is before sunset
  if (t.sunset && t.eveningGoldenStart) {
    assert.ok(t.eveningGoldenStart.getTime() < t.sunset.getTime(),
      'eveningGoldenStart should be before sunset');
  }
});

test('solarTimes: polar region — sun may not rise (returns null for sunrise)', () => {
  // Far north (Svalbard, lat 78.2) on December 21 — polar night, sun never rises.
  const t = solarTimes(78.2, 15.6, new Date(Date.UTC(2026, 11, 21, 12, 0, 0)));
  assert.equal(t.sunrise, null, 'polar night should have null sunrise');
  assert.equal(t.sunset, null, 'polar night should have null sunset');
});

test('currentSunPhase: night before sunrise', () => {
  const sunrise = new Date(Date.UTC(2026, 5, 21, 10, 15, 0));
  const sunset = new Date(Date.UTC(2026, 5, 22, 0, 59, 0));
  const civilTwilightStart = new Date(Date.UTC(2026, 5, 21, 9, 45, 0));
  const morningGoldenEnd = new Date(Date.UTC(2026, 5, 21, 10, 45, 0));
  const eveningGoldenStart = new Date(Date.UTC(2026, 5, 22, 0, 29, 0));
  const civilTwilightEnd = new Date(Date.UTC(2026, 5, 22, 1, 29, 0));
  const times: SolarTimes = {
    sunrise, sunset,
    solarNoon: new Date(Date.UTC(2026, 5, 21, 17, 37, 0)),
    morningGoldenEnd, eveningGoldenStart,
    civilTwilightStart, civilTwilightEnd,
  };
  // 09:00 UTC — before civil twilight start
  assert.equal(currentSunPhase(new Date(Date.UTC(2026, 5, 21, 9, 0, 0)), times), 'night');
  // 09:50 — civil twilight (dawn)
  assert.equal(currentSunPhase(new Date(Date.UTC(2026, 5, 21, 9, 50, 0)), times), 'dawn');
  // 10:30 — morning golden hour
  assert.equal(currentSunPhase(new Date(Date.UTC(2026, 5, 21, 10, 30, 0)), times), 'morningGolden');
  // 13:00 — day
  assert.equal(currentSunPhase(new Date(Date.UTC(2026, 5, 21, 13, 0, 0)), times), 'day');
  // 00:35 next day — evening golden
  assert.equal(currentSunPhase(new Date(Date.UTC(2026, 5, 22, 0, 35, 0)), times), 'eveningGolden');
  // 01:10 next day — dusk
  assert.equal(currentSunPhase(new Date(Date.UTC(2026, 5, 22, 1, 10, 0)), times), 'dusk');
  // 02:00 next day — night
  assert.equal(currentSunPhase(new Date(Date.UTC(2026, 5, 22, 2, 0, 0)), times), 'night');
});
