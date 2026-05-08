/** OpenSky Network — anonymous /api/states/all bbox query. Rate limited to
 *  ~10 req/min for unauthenticated users; we poll every 30s. CORS supported. */

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

/** OpenSky returns each state vector as a positional array of length 17. */
type RawState = [
  string,            // 0  icao24
  string | null,     // 1  callsign
  string,            // 2  origin_country
  number | null,     // 3  time_position
  number | null,     // 4  last_contact
  number | null,     // 5  longitude
  number | null,     // 6  latitude
  number | null,     // 7  baro_altitude
  boolean,           // 8  on_ground
  number | null,     // 9  velocity (m/s)
  number | null,     // 10 true_track (heading)
  number | null,     // 11 vertical_rate
  ...unknown[],
];

export async function fetchAircraftInBox(
  centerLat: number, centerLon: number, radiusKm: number,
): Promise<Aircraft[]> {
  // Rough degree-per-km conversion. Acceptable distortion for radii ≤ 200 km.
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.max(0.1, Math.cos(centerLat * Math.PI / 180)));
  const url = `https://opensky-network.org/api/states/all`
    + `?lamin=${(centerLat - dLat).toFixed(3)}`
    + `&lomin=${(centerLon - dLon).toFixed(3)}`
    + `&lamax=${(centerLat + dLat).toFixed(3)}`
    + `&lomax=${(centerLon + dLon).toFixed(3)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data: unknown = await res.json();
    const states = (data as { states?: unknown }).states;
    if (!Array.isArray(states)) return [];
    return states
      .map((row): Aircraft | null => {
        if (!Array.isArray(row) || row.length < 12) return null;
        const r = row as RawState;
        if (typeof r[5] !== 'number' || typeof r[6] !== 'number') return null;
        return {
          icao24: r[0] ?? '',
          callsign: (r[1] ?? '').trim(),
          originCountry: r[2] ?? '',
          lat: r[6],
          lon: r[5],
          altitude: typeof r[7] === 'number' ? r[7] : 0,
          velocity: typeof r[9] === 'number' ? r[9] : 0,
          heading: typeof r[10] === 'number' ? r[10] : 0,
          onGround: !!r[8],
        };
      })
      .filter((x): x is Aircraft => x !== null);
  } catch (err) {
    console.warn('opensky fetch failed', err);
    return [];
  }
}
