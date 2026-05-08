/** Open-Meteo Air Quality API.
 *  Public, key-less, CORS-friendly. We pull US AQI, UV index, and the two
 *  PM constituents — that's enough for an at-a-glance tile and avoids the
 *  EAQI/CAQI variants that would only confuse a US audience. */

export interface AirQualitySample {
  /** US-style AQI (0..500). null when unavailable. */
  usAqi: number | null;
  /** UV index (0..~12). null when unavailable. */
  uvIndex: number | null;
  /** PM2.5 in µg/m³. null when unavailable. */
  pm25: number | null;
  /** PM10 in µg/m³. null when unavailable. */
  pm10: number | null;
  /** Wall-clock seconds when the sample was fetched. */
  fetchedAt: number;
}

export async function fetchAirQuality(lat: number, lon: number): Promise<AirQualitySample | null> {
  try {
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=us_aqi,uv_index,pm2_5,pm10`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (!data || typeof data !== 'object') return null;
    const current = (data as { current?: Record<string, unknown> }).current;
    if (!current || typeof current !== 'object') return null;
    const num = (k: string): number | null => {
      const v = current[k];
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    };
    return {
      usAqi: num('us_aqi'),
      uvIndex: num('uv_index'),
      pm25: num('pm2_5'),
      pm10: num('pm10'),
      fetchedAt: Date.now() / 1000,
    };
  } catch (err) {
    console.warn('air-quality fetch failed', err);
    return null;
  }
}

export interface AqiCategory {
  label: string;
  color: string;
  /** Short health note shown on the tile when the category is at or above moderate. */
  hint: string;
}

/** US EPA AQI bands. */
export function aqiCategory(aqi: number | null): AqiCategory {
  if (aqi == null) return { label: '—', color: 'rgba(255,255,255,0.4)', hint: '' };
  if (aqi <= 50)   return { label: 'Good',      color: '#22c55e', hint: '' };
  if (aqi <= 100)  return { label: 'Moderate',  color: '#facc15', hint: 'Sensitive groups: limit prolonged exertion' };
  if (aqi <= 150)  return { label: 'Unhealthy for sensitive groups', color: '#fb923c', hint: 'Sensitive groups: limit outdoor activity' };
  if (aqi <= 200)  return { label: 'Unhealthy', color: '#ef4444', hint: 'Everyone: reduce prolonged outdoor activity' };
  if (aqi <= 300)  return { label: 'Very unhealthy', color: '#a855f7', hint: 'Avoid prolonged outdoor exertion' };
  return { label: 'Hazardous', color: '#7f1d1d', hint: 'Avoid all outdoor activity' };
}

export interface UvCategory {
  label: string;
  color: string;
  hint: string;
}

/** WHO UV index bands. */
export function uvCategory(uv: number | null): UvCategory {
  if (uv == null) return { label: '—', color: 'rgba(255,255,255,0.4)', hint: '' };
  if (uv < 3)  return { label: 'Low',       color: '#22c55e', hint: '' };
  if (uv < 6)  return { label: 'Moderate',  color: '#facc15', hint: 'Sunglasses + SPF 30+' };
  if (uv < 8)  return { label: 'High',      color: '#fb923c', hint: 'SPF 30+, hat, midday shade' };
  if (uv < 11) return { label: 'Very high', color: '#ef4444', hint: 'Avoid sun 10am–4pm' };
  return { label: 'Extreme', color: '#a855f7', hint: 'Stay indoors near solar noon' };
}
