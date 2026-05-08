/** eBird recent observations API.
 *  https://api.ebird.org/v2/data/obs/geo/recent?lat=&lng=&dist=
 *  Requires a free API key obtained at https://ebird.org/api/keygen.
 *  CORS friendly. */

const TOKEN_KEY = '2mh.ebird.token';
const RADIUS_KEY = '2mh.ebird.radius';

export interface BirdObservation {
  speciesCode: string;
  comName: string;     // common name
  sciName: string;     // scientific name
  obsDt: string;       // local timestamp string e.g. "2026-05-08 14:32"
  howMany: number | null;
  locName: string;
  /** Distance in km from caller, computed client-side. */
  distanceKm?: number;
}

export function getStoredToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? '';
}
export function setStoredToken(t: string): void {
  if (t.trim()) localStorage.setItem(TOKEN_KEY, t.trim());
  else localStorage.removeItem(TOKEN_KEY);
}
export function getStoredRadius(): number {
  const raw = localStorage.getItem(RADIUS_KEY);
  const n = raw != null ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 50 ? n : 25;
}
export function setStoredRadius(km: number): void {
  if (Number.isFinite(km) && km > 0 && km <= 50) {
    localStorage.setItem(RADIUS_KEY, String(km));
  }
}

interface RawObservation {
  speciesCode?: string;
  comName?: string;
  sciName?: string;
  obsDt?: string;
  howMany?: number;
  locName?: string;
  lat?: number;
  lng?: number;
}

export async function fetchRecentBirds(token: string, lat: number, lon: number, radiusKm: number): Promise<BirdObservation[]> {
  if (!token) return [];
  try {
    const url = `https://api.ebird.org/v2/data/obs/geo/recent`
      + `?lat=${lat.toFixed(4)}&lng=${lon.toFixed(4)}&dist=${Math.min(50, Math.max(1, radiusKm))}`;
    const res = await fetch(url, { headers: { 'X-eBirdApiToken': token } });
    if (!res.ok) {
      if (res.status === 403) throw new Error('eBird rejected the API token');
      return [];
    }
    const data: unknown = await res.json();
    if (!Array.isArray(data)) return [];
    return data
      .map((raw): BirdObservation | null => {
        if (!raw || typeof raw !== 'object') return null;
        const r = raw as RawObservation;
        if (typeof r.speciesCode !== 'string' || typeof r.comName !== 'string') return null;
        return {
          speciesCode: r.speciesCode,
          comName: r.comName,
          sciName: r.sciName ?? '',
          obsDt: r.obsDt ?? '',
          howMany: typeof r.howMany === 'number' ? r.howMany : null,
          locName: r.locName ?? '',
        };
      })
      .filter((x): x is BirdObservation => x !== null);
  } catch (err) {
    console.warn('ebird fetch failed', err);
    throw err;
  }
}
