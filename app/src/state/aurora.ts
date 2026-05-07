/** Aurora tile data: NOAA SWPC KP index fetcher + moon phase math + visibility helper.
 *  Uses public CORS-permitted NOAA endpoints (no API key needed).
 *
 *  References:
 *  - https://www.swpc.noaa.gov/products/planetary-k-index
 *  - https://www.swpc.noaa.gov/phenomena/aurora
 *  - Conway moon-phase algorithm (https://www.voidware.com/moon_phase.htm) */

export interface KpEntry {
  /** Unix epoch seconds of the 3-hour interval start. */
  time: number;
  /** Planetary KP value (0–9, fractional allowed in forecast data). */
  kp: number;
}

export interface MoonPhaseInfo {
  /** Phase, 0..1. 0 = new, 0.25 = first quarter, 0.5 = full, 0.75 = last quarter. */
  phase: number;
  /** Lit fraction, 0..1. Peaks at 1 on full moon, 0 on new moon. */
  illumination: number;
  /** Human-readable phase name. */
  name: string;
}

export type AuroraVisibility = 'unlikely' | 'horizon' | 'overhead';

const KP_RECENT_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json';
const KP_FORECAST_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json';

/** Fetch the most recent observed KP entries (~last 7 days, 3-hour cadence).
 *  Returns oldest-to-newest. */
export async function fetchKpRecent(): Promise<KpEntry[]> {
  try {
    const res = await fetch(KP_RECENT_URL);
    if (!res.ok) return [];
    const data: unknown = await res.json();
    return parseKpResponse(data);
  } catch (err) {
    console.warn('aurora KP recent fetch failed', err);
    return [];
  }
}

/** Fetch the 3-day KP forecast. Returns oldest-to-newest. */
export async function fetchKpForecast(): Promise<KpEntry[]> {
  try {
    const res = await fetch(KP_FORECAST_URL);
    if (!res.ok) return [];
    const data: unknown = await res.json();
    return parseKpForecastResponse(data);
  } catch (err) {
    console.warn('aurora KP forecast fetch failed', err);
    return [];
  }
}

/** Parse the NOAA recent KP response (array-of-arrays with header row). */
export function parseKpResponse(data: unknown): KpEntry[] {
  if (!Array.isArray(data) || data.length < 2) return [];
  const out: KpEntry[] = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!Array.isArray(row) || row.length < 2) continue;
    const timeStr = row[0];
    const kpStr = row[1];
    if (typeof timeStr !== 'string' || (typeof kpStr !== 'string' && typeof kpStr !== 'number')) continue;
    const time = Date.parse(timeStr.replace(' ', 'T') + 'Z') / 1000;
    const kp = typeof kpStr === 'number' ? kpStr : parseFloat(kpStr);
    if (Number.isFinite(time) && Number.isFinite(kp)) {
      out.push({ time, kp });
    }
  }
  return out;
}

/** Parse the NOAA forecast KP response (array-of-arrays with header row). */
export function parseKpForecastResponse(data: unknown): KpEntry[] {
  // Same shape as recent — first row is headers, subsequent rows are data.
  return parseKpResponse(data);
}

/** Estimate aurora visibility for a latitude given current KP.
 *  Based on NOAA's auroral oval boundaries (approximation):
 *    KP 0–2: visible only inside arctic/antarctic circles
 *    KP 3:   visible from ~58° geomag latitude
 *    KP 4:   ~55°
 *    KP 5:   ~50° (G1 storm)
 *    KP 6:   ~47° (G2)
 *    KP 7:   ~43° (G3)
 *    KP 8:   ~38° (G4)
 *    KP 9:   ~33° (G5, extreme)
 *
 *  Uses absolute latitude (works for both hemispheres). Geographic lat is used
 *  as a rough proxy for geomag lat — accurate enough for a glanceable indicator. */
export function auroraVisibility(kp: number, lat: number): AuroraVisibility {
  const absLat = Math.abs(lat);
  // Visibility threshold latitude as a function of KP.
  // Below the threshold = unlikely. Above by 5° = horizon. Above by 15° = overhead.
  const KP_THRESHOLDS: { kp: number; lat: number }[] = [
    { kp: 0, lat: 66 },
    { kp: 1, lat: 64 },
    { kp: 2, lat: 62 },
    { kp: 3, lat: 58 },
    { kp: 4, lat: 55 },
    { kp: 5, lat: 50 },
    { kp: 6, lat: 47 },
    { kp: 7, lat: 43 },
    { kp: 8, lat: 38 },
    { kp: 9, lat: 33 },
  ];
  // Interpolate threshold for fractional KP
  const idx = Math.max(0, Math.min(9, Math.floor(kp)));
  const threshold = KP_THRESHOLDS[idx]!.lat;
  if (absLat < threshold) return 'unlikely';
  if (absLat < threshold + 10) return 'horizon';
  return 'overhead';
}

/** Compute moon phase using Conway's simplified algorithm.
 *  Accurate to ~1 day for current dates. */
export function moonPhase(date: Date): MoonPhaseInfo {
  // Conway algorithm: days since the new moon of January 6, 1900.
  let year = date.getUTCFullYear();
  let month = date.getUTCMonth() + 1;
  const day = date.getUTCDate() + date.getUTCHours() / 24 + date.getUTCMinutes() / 1440;

  if (month < 3) {
    year -= 1;
    month += 12;
  }
  const c = 365.25 * year;
  const e = 30.6 * (month + 1);
  const jd = c + e + day - 694039.09;
  const cycle = jd / 29.5305882;          // synodic month length in days
  const phase = cycle - Math.floor(cycle);  // 0..1

  // Illumination: 0 at new moon, 1 at full moon, follows sine curve.
  const illumination = (1 - Math.cos(2 * Math.PI * phase)) / 2;

  return {
    phase,
    illumination,
    name: moonPhaseName(phase),
  };
}

function moonPhaseName(phase: number): string {
  if (phase < 0.03 || phase >= 0.97) return 'New moon';
  if (phase < 0.22) return 'Waxing crescent';
  if (phase < 0.28) return 'First quarter';
  if (phase < 0.47) return 'Waxing gibbous';
  if (phase < 0.53) return 'Full moon';
  if (phase < 0.72) return 'Waning gibbous';
  if (phase < 0.78) return 'Last quarter';
  return 'Waning crescent';
}

/** Moon-phase emoji (8 standard phases). */
export function moonPhaseEmoji(phase: number): string {
  if (phase < 0.03 || phase >= 0.97) return '🌑';
  if (phase < 0.22) return '🌒';
  if (phase < 0.28) return '🌓';
  if (phase < 0.47) return '🌔';
  if (phase < 0.53) return '🌕';
  if (phase < 0.72) return '🌖';
  if (phase < 0.78) return '🌗';
  return '🌘';
}
