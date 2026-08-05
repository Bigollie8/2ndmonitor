/** OpenSky Network anonymous /api/states/all bbox query, routed through the
 *  Rust backend. Direct browser fetches were unreliable: OpenSky's CORS posture
 *  flips occasionally and anonymous rate limits got tightened in 2024. The
 *  Tauri proxy bypasses CORS and centralizes the User-Agent / timeout. */

import { isTauri } from './tauri';

/** Poll interval for the aircraft tile.
 *
 *  Anonymous OpenSky allows a few hundred credits per day. The previous 60s
 *  interval was 1440 requests/day, so the tile exhausted its budget within
 *  hours of uptime and then served HTTP 429 for the rest of the day — which
 *  read as "the API is broken" rather than "we spent the allowance". 5 minutes
 *  is 288/day, comfortably inside it even if a bbox costs more than one
 *  credit. usePoll's backoff (up to 8x on consecutive failures) then tops out
 *  around 40 minutes, which is a sane retry rate for a daily quota rather than
 *  the ~8 minutes the old base interval produced. */
export const AIRCRAFT_REFRESH_MS = 5 * 60 * 1000;

export interface AircraftErrorInfo {
  /** True when the failure is OpenSky's rate limiter, not an outage. */
  rateLimited: boolean;
  /** Short status-line label. */
  label: string;
  /** One-line explanation shown under the error. */
  hint: string;
}

/** Classify a backend error string for display. Pure — unit-tested. */
export function describeAircraftError(message: string | null): AircraftErrorInfo | null {
  if (message == null) return null;
  if (/\b429\b/.test(message)) {
    return {
      rateLimited: true,
      label: 'OpenSky limit',
      // Deliberately does NOT promise a quick recovery: this is a daily
      // allowance, so it can stay exhausted for hours.
      hint: 'OpenSky’s free tier has a daily request allowance and this one is used up. It resets on OpenSky’s schedule — the tile keeps retrying in the background.',
    };
  }
  return {
    rateLimited: false,
    label: 'OpenSky unavailable',
    hint: 'Couldn’t reach OpenSky. The tile keeps retrying in the background.',
  };
}

export interface Aircraft {
  icao24: string;
  callsign: string;
  originCountry: string;
  lat: number;
  lon: number;
  /** Altitude in meters (barometric). */
  altitude: number;
  /** Ground speed in m/s. */
  velocity: number;
  /** Heading in degrees, 0=N. */
  heading: number;
  onGround: boolean;
}

export interface AircraftFetchResult {
  aircraft: Aircraft[];
  /** Non-null when the request failed (CORS, rate limit, network). */
  error: string | null;
}

interface RawAircraftState {
  icao24: string;
  callsign: string;
  origin_country: string;
  lat: number;
  lon: number;
  altitude: number;
  velocity: number;
  heading: number;
  on_ground: boolean;
}

interface RawAircraftResult {
  states: RawAircraftState[];
  error: string | null;
}

export async function fetchAircraftInBox(
  centerLat: number, centerLon: number, radiusKm: number,
): Promise<AircraftFetchResult> {
  if (!isTauri) return { aircraft: [], error: null };
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const raw = await invoke<RawAircraftResult>('fetch_aircraft_states', {
      lat: centerLat,
      lon: centerLon,
      radiusKm,
    });
    return {
      aircraft: raw.states.map((s) => ({
        icao24: s.icao24,
        callsign: s.callsign,
        originCountry: s.origin_country,
        lat: s.lat,
        lon: s.lon,
        altitude: s.altitude,
        velocity: s.velocity,
        heading: s.heading,
        onGround: s.on_ground,
      })),
      error: raw.error,
    };
  } catch (err) {
    console.warn('fetch_aircraft_states failed', err);
    return { aircraft: [], error: String(err) };
  }
}
