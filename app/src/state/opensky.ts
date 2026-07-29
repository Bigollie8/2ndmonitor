/** OpenSky Network anonymous /api/states/all bbox query, routed through the
 *  Rust backend. Direct browser fetches were unreliable: OpenSky's CORS posture
 *  flips occasionally and anonymous rate limits got tightened in 2024. The
 *  Tauri proxy bypasses CORS and centralizes the User-Agent / timeout. */

import { isTauri } from './tauri';

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
