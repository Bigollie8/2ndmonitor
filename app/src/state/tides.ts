import { isTauri } from './tauri';

export interface TideEvent {
  /** NOAA's local-time string: "2026-05-08 12:34". */
  t: string;
  /** Height in feet. */
  v: number;
  /** "H" for high tide, "L" for low. */
  kind: string;
}

export interface TidePredictions {
  station_id: string;
  events: TideEvent[];
  error: string | null;
}

export async function fetchTidePredictions(stationId: string): Promise<TidePredictions | null> {
  if (!isTauri) return null;
  if (!stationId.trim()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<TidePredictions>('fetch_tide_predictions', { stationId: stationId.trim() });
  } catch (err) {
    console.warn('fetch_tide_predictions failed', err);
    return null;
  }
}

export interface TidesConfig {
  /** NOAA station ID, e.g. "8443970" (Boston). Empty = unconfigured. */
  stationId: string;
  /** Display name shown in the tile header. */
  stationLabel: string;
}

export const DEFAULT_TIDES_CONFIG: TidesConfig = {
  stationId: '',
  stationLabel: '',
};

export function parseTidesConfig(raw: unknown): TidesConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_TIDES_CONFIG;
  const c = raw as Record<string, unknown>;
  const stationId = typeof c.stationId === 'string' ? c.stationId.trim().slice(0, 16) : '';
  const stationLabel = typeof c.stationLabel === 'string' ? c.stationLabel.trim().slice(0, 64) : '';
  return { stationId, stationLabel };
}

/** Parse "YYYY-MM-DD HH:MM" as the user's local time. NOAA returns LST/LDT
 *  strings without an offset, which is fine because we just want
 *  "minutes from now" arithmetic. */
export function parseNoaaTime(t: string): number | null {
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)).getTime();
}
