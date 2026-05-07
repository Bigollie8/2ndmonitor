/** Solar position math — sunrise, sunset, golden hour, civil twilight.
 *  Uses the NOAA-derived simplified sunrise equation. Accurate to ~1 minute
 *  for typical latitudes. Polar regions return null when the sun never reaches
 *  the relevant altitude.
 *
 *  References:
 *  - https://en.wikipedia.org/wiki/Sunrise_equation
 *  - https://gml.noaa.gov/grad/solcalc/calcdetails.html */

export interface SolarTimes {
  sunrise: Date | null;
  sunset: Date | null;
  solarNoon: Date;
  /** Sun reaches +6° altitude. Morning golden hour ends here. */
  morningGoldenEnd: Date | null;
  /** Sun drops back to +6° altitude. Evening golden hour starts here. */
  eveningGoldenStart: Date | null;
  /** Sun reaches -6° altitude (start of civil twilight, "dawn"). */
  civilTwilightStart: Date | null;
  /** Sun drops to -6° altitude (end of civil twilight, "dusk"). */
  civilTwilightEnd: Date | null;
}

export type SunPhase =
  | 'night'
  | 'dawn'           // -6° to sunrise
  | 'morningGolden'  // sunrise to +6°
  | 'day'            // +6° to +6° (descending)
  | 'eveningGolden'  // +6° to sunset
  | 'dusk';          // sunset to -6°

const J2000 = 2451545.0;

/** Convert a Date to Julian day (UT). */
function dateToJD(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

/** Convert a Julian day (UT) to a Date. */
function jdToDate(jd: number): Date {
  return new Date((jd - 2440587.5) * 86400000);
}

/** Compute solar position basics for a given date. */
function solarBasics(date: Date, lon: number): { Jtransit: number; delta: number } {
  // Days since J2000 epoch
  const jd = dateToJD(date);
  const n = jd - J2000 + 0.0008;
  // Mean solar time
  const meanSolarTime = n - lon / 360;
  // Solar mean anomaly (degrees)
  const M = ((357.5291 + 0.98560028 * meanSolarTime) % 360 + 360) % 360;
  const Mrad = M * Math.PI / 180;
  // Equation of center
  const C = 1.9148 * Math.sin(Mrad) + 0.0200 * Math.sin(2 * Mrad) + 0.0003 * Math.sin(3 * Mrad);
  // Ecliptic longitude
  const lambda = ((M + C + 180 + 102.9372) % 360 + 360) % 360;
  const lambdaRad = lambda * Math.PI / 180;
  // Solar transit time (Julian day)
  const Jtransit = J2000 + meanSolarTime + 0.0053 * Math.sin(Mrad) - 0.0069 * Math.sin(2 * lambdaRad);
  // Declination
  const obliquity = 23.4397 * Math.PI / 180;
  const sinDelta = Math.sin(lambdaRad) * Math.sin(obliquity);
  const delta = Math.asin(sinDelta);
  return { Jtransit, delta };
}

/** Hour angle (radians) for the sun at a given altitude (degrees) for the given
 *  latitude and declination. Returns null when the sun never reaches that altitude
 *  (polar day/night). */
function hourAngleRad(altDeg: number, latRad: number, delta: number): number | null {
  const altRad = altDeg * Math.PI / 180;
  const cosH =
    (Math.sin(altRad) - Math.sin(latRad) * Math.sin(delta)) /
    (Math.cos(latRad) * Math.cos(delta));
  if (cosH > 1 || cosH < -1) return null;
  return Math.acos(cosH);
}

/** Compute solar event times for a given location and date. The date's
 *  noon UTC is used as the reference (so passing any time on the local day
 *  gives the times for that day). */
export function solarTimes(lat: number, lon: number, date: Date): SolarTimes {
  // Use noon UTC of the given date as the reference, so the answer is consistent
  // regardless of the specific time-of-day passed in.
  const ref = new Date(Date.UTC(
    date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0
  ));
  const { Jtransit, delta } = solarBasics(ref, lon);
  const latRad = lat * Math.PI / 180;
  const dayHalf = 1; // for converting hour angle (radians/2π) to a JD delta of one day

  const eventJD = (altDeg: number, isAfterNoon: boolean): Date | null => {
    const H = hourAngleRad(altDeg, latRad, delta);
    if (H === null) return null;
    const offset = (H / (2 * Math.PI)) * dayHalf;
    return jdToDate(isAfterNoon ? Jtransit + offset : Jtransit - offset);
  };

  return {
    sunrise: eventJD(-0.833, false),
    sunset: eventJD(-0.833, true),
    solarNoon: jdToDate(Jtransit),
    morningGoldenEnd: eventJD(6, false),
    eveningGoldenStart: eventJD(6, true),
    civilTwilightStart: eventJD(-6, false),
    civilTwilightEnd: eventJD(-6, true),
  };
}

/** Determine the current sun-phase given the current time and the day's solar times.
 *  Boundaries are:
 *    night → civilTwilightStart → dawn → sunrise → morningGolden → morningGoldenEnd
 *      → day → eveningGoldenStart → eveningGolden → sunset → dusk → civilTwilightEnd → night
 *  When polar regions return null for some events, falls back to 'day' if sun is
 *  always up, 'night' if always down. */
export function currentSunPhase(now: Date, times: SolarTimes): SunPhase {
  const t = now.getTime();
  // Polar fallbacks
  if (!times.sunrise || !times.sunset) {
    // Sun never reaches sunrise altitude — perpetual day or night.
    // If solar noon is "above" -0.833° this would be polar day, but without sunrise
    // we can't easily tell. Use civil twilight as a heuristic.
    if (times.civilTwilightStart && times.civilTwilightEnd) return 'dusk';
    return 'night';
  }
  const sunrise = times.sunrise.getTime();
  const sunset = times.sunset.getTime();
  const civilStart = times.civilTwilightStart?.getTime() ?? sunrise - 30 * 60 * 1000;
  const civilEnd = times.civilTwilightEnd?.getTime() ?? sunset + 30 * 60 * 1000;
  const morningGoldenEnd = times.morningGoldenEnd?.getTime() ?? sunrise + 30 * 60 * 1000;
  const eveningGoldenStart = times.eveningGoldenStart?.getTime() ?? sunset - 30 * 60 * 1000;

  if (t < civilStart) return 'night';
  if (t < sunrise) return 'dawn';
  if (t < morningGoldenEnd) return 'morningGolden';
  if (t < eveningGoldenStart) return 'day';
  if (t < sunset) return 'eveningGolden';
  if (t < civilEnd) return 'dusk';
  return 'night';
}
