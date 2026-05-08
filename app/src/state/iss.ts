/** ISS live position from wheretheiss.at — public, key-less, CORS-friendly.
 *  https://wheretheiss.at/w/developer */

export interface IssPosition {
  lat: number;
  lon: number;
  /** Altitude in km. */
  altitude: number;
  /** Ground speed in km/h. */
  velocity: number;
  /** Visibility from Earth: "daylight" / "eclipsed" — used for a sun/shadow icon. */
  visibility: string;
  fetchedAt: number;
}

export async function fetchIssPosition(): Promise<IssPosition | null> {
  try {
    const res = await fetch('https://api.wheretheiss.at/v1/satellites/25544');
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (!data || typeof data !== 'object') return null;
    const d = data as { latitude?: unknown; longitude?: unknown; altitude?: unknown; velocity?: unknown; visibility?: unknown };
    const num = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
    const lat = num(d.latitude);
    const lon = num(d.longitude);
    if (lat == null || lon == null) return null;
    return {
      lat, lon,
      altitude: num(d.altitude) ?? 0,
      velocity: num(d.velocity) ?? 0,
      visibility: typeof d.visibility === 'string' ? d.visibility : '',
      fetchedAt: Date.now() / 1000,
    };
  } catch (err) {
    console.warn('iss fetch failed', err);
    return null;
  }
}

/** Great-circle distance in km between two lat/lon points (haversine). */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
