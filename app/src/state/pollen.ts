/** Open-Meteo air quality, pollen-and-smoke variant.
 *  Same host as the AQI tile but querying the pollen + dust + smoke bands.
 *  Free, no key, CORS friendly. */

export interface PollenSample {
  /** Grass pollen concentration (grains/m³). */
  grass: number | null;
  /** Tree pollen — birch is the most common high-allergen reference. */
  birch: number | null;
  /** Olive — tracked separately because it's a major allergen in some regions. */
  olive: number | null;
  /** Generic ragweed (autumn allergens). */
  ragweed: number | null;
  /** Alder pollen. */
  alder: number | null;
  /** Mugwort pollen. */
  mugwort: number | null;
  /** PM2.5 µg/m³ — used as a wildfire-smoke proxy when elevated. */
  pm25: number | null;
  /** Local US AQI for context. */
  usAqi: number | null;
  fetchedAt: number;
}

export async function fetchPollenSample(lat: number, lon: number): Promise<PollenSample | null> {
  try {
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality`
      + `?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`
      + `&current=us_aqi,pm2_5,grass_pollen,birch_pollen,olive_pollen,ragweed_pollen,alder_pollen,mugwort_pollen`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data: unknown = await res.json();
    const current = (data as { current?: Record<string, unknown> }).current;
    if (!current || typeof current !== 'object') return null;
    const num = (k: string): number | null => {
      const v = current[k];
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    };
    return {
      grass: num('grass_pollen'),
      birch: num('birch_pollen'),
      olive: num('olive_pollen'),
      ragweed: num('ragweed_pollen'),
      alder: num('alder_pollen'),
      mugwort: num('mugwort_pollen'),
      pm25: num('pm2_5'),
      usAqi: num('us_aqi'),
      fetchedAt: Date.now() / 1000,
    };
  } catch (err) {
    console.warn('pollen fetch failed', err);
    return null;
  }
}

export interface PollenLevel {
  label: string;
  color: string;
}

/** Conservative tiered bands. Open-Meteo doesn't publish official thresholds
 *  so we use values aligned with most national pollen-index guidance:
 *    <10  low, <50  moderate, <100 high, >=100 very high. */
export function pollenLevel(grains: number | null): PollenLevel {
  if (grains == null) return { label: '—', color: 'rgba(255,255,255,0.3)' };
  if (grains < 10)  return { label: 'low',       color: '#22c55e' };
  if (grains < 50)  return { label: 'moderate',  color: '#facc15' };
  if (grains < 100) return { label: 'high',      color: '#fb923c' };
  return { label: 'very high', color: '#ef4444' };
}

/** PM2.5 → smoke risk band. Most wildfire-impact research uses 35 µg/m³ as
 *  the "unhealthy for sensitive groups" threshold and 55 as "unhealthy". */
export function smokeLevel(pm25: number | null): PollenLevel {
  if (pm25 == null) return { label: '—', color: 'rgba(255,255,255,0.3)' };
  if (pm25 < 12)   return { label: 'clean',    color: '#22c55e' };
  if (pm25 < 35)   return { label: 'moderate', color: '#facc15' };
  if (pm25 < 55)   return { label: 'unhealthy (sensitive)', color: '#fb923c' };
  if (pm25 < 150)  return { label: 'unhealthy', color: '#ef4444' };
  return { label: 'hazardous', color: '#a855f7' };
}
