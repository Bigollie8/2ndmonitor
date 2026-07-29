/** Pollen + wildfire-smoke data sources.
 *
 *  Two-source strategy — Open-Meteo's CAMS pollen model is Europe-only, so for
 *  US (and most non-EU) users it returns null pollen fields. Google Pollen
 *  API is global; user provides a free Google Maps Platform API key (10K
 *  req/month free tier).
 *
 *  Fetch order:
 *    1. Always pull PM2.5 + US AQI from Open-Meteo (universal, key-less).
 *    2. If a Google Pollen key is set, fetch grass/tree/weed indices there.
 *    3. Else fall back to Open-Meteo pollen fields (Europe only).
 *
 *  Indices in the unified `PollenSample` are mapped to a 0..5 scale
 *  matching Google's UPI bands; Open-Meteo grain counts are bucketed onto
 *  the same scale via `bucketFromGrains`. */

// The Google Pollen API key lives in the encrypted secret store (see
// state/secrets.ts, key "google_pollen_key"; legacy localStorage key
// "2mh.googlePollen.token" is migrated on first read). Callers pass it to
// `fetchPollenSample` explicitly.

export interface PollenSample {
  /** Source identifier, surfaced in the UI so the user knows where the
   *  numbers came from. */
  source: 'google' | 'open-meteo' | 'none';
  /** 0..5 universal pollen index, Google-style. null when unavailable. */
  grass: number | null;
  tree: number | null;
  weed: number | null;
  /** Whether each pollen type is currently in its active season. Lets the UI
   *  distinguish "0 because out of season" (e.g. weed in TN in May) from
   *  "0 because clean today, in season". null when the source doesn't report
   *  seasonality (Open-Meteo). */
  grassInSeason: boolean | null;
  treeInSeason: boolean | null;
  weedInSeason: boolean | null;
  /** Top contributing plant species, when Google Pollen is the source. */
  topPlants: { name: string; index: number }[];
  /** Actionable allergy advice strings from Google, taken from the
   *  highest-severity pollen type so the rotating tip surfaces the most
   *  relevant guidance. Empty when no recommendations are available. */
  healthRecommendations: string[];
  /** PM2.5 µg/m³ — wildfire-smoke proxy. Always Open-Meteo. */
  pm25: number | null;
  /** Local US AQI for context. */
  usAqi: number | null;
  fetchedAt: number;
}

export interface OpenMeteoCurrent {
  us_aqi?: number;
  pm2_5?: number;
  grass_pollen?: number;
  birch_pollen?: number;
  olive_pollen?: number;
  ragweed_pollen?: number;
  alder_pollen?: number;
  mugwort_pollen?: number;
}

/** Bucket Open-Meteo's grains-per-m³ value into Google's 0..5 universal
 *  pollen index. Thresholds approximate national pollen-bureau guidance. */
export function bucketFromGrains(grains: number | null): number | null {
  if (grains == null) return null;
  if (grains < 1)   return 0; // none
  if (grains < 10)  return 1; // very low
  if (grains < 50)  return 2; // low
  if (grains < 100) return 3; // moderate
  if (grains < 200) return 4; // high
  return 5;                   // very high
}

async function fetchOpenMeteo(lat: number, lon: number): Promise<OpenMeteoCurrent | null> {
  try {
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality`
      + `?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`
      + `&current=us_aqi,pm2_5,grass_pollen,birch_pollen,olive_pollen,ragweed_pollen,alder_pollen,mugwort_pollen`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data: unknown = await res.json();
    const current = (data as { current?: OpenMeteoCurrent }).current;
    return current ?? null;
  } catch (err) {
    console.warn('open-meteo fetch failed', err);
    return null;
  }
}

interface GooglePollenResponse {
  dailyInfo?: {
    pollenTypeInfo?: {
      code?: string;
      inSeason?: boolean;
      indexInfo?: { value?: number };
      healthRecommendations?: string[];
    }[];
    plantInfo?: {
      displayName?: string;
      indexInfo?: { value?: number };
    }[];
  }[];
}

export interface GooglePollenResult {
  grass: number | null;
  tree: number | null;
  weed: number | null;
  grassInSeason: boolean | null;
  treeInSeason: boolean | null;
  weedInSeason: boolean | null;
  topPlants: { name: string; index: number }[];
  healthRecommendations: string[];
}

async function fetchGooglePollen(token: string, lat: number, lon: number): Promise<GooglePollenResult | null> {
  try {
    const url = `https://pollen.googleapis.com/v1/forecast:lookup`
      + `?key=${encodeURIComponent(token)}`
      + `&location.longitude=${lon.toFixed(4)}&location.latitude=${lat.toFixed(4)}`
      + `&days=1&plantsDescription=false`;
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Google Pollen rejected the key (${res.status}): ${txt.slice(0, 120)}`);
      }
      return null;
    }
    const data = await res.json() as GooglePollenResponse;
    const today = data.dailyInfo?.[0];
    if (!today) return null;

    interface TypeData { value: number | null; inSeason: boolean | null; tips: string[] }
    const typeData = (code: string): TypeData => {
      const entry = today.pollenTypeInfo?.find((p) => p.code === code);
      if (!entry) return { value: null, inSeason: null, tips: [] };
      // Google omits indexInfo for pollen types that are out of season or have
      // no detectable count (e.g. weed in TN in May). The entry itself is
      // still reported, which means "data exists, current value is zero" — not
      // "unavailable". Render it as 0 so the tile shows "0/5 none" instead of —.
      const v = entry.indexInfo?.value;
      return {
        value: typeof v === 'number' ? v : 0,
        inSeason: entry.inSeason ?? null,
        tips: entry.healthRecommendations ?? [],
      };
    };

    const grass = typeData('GRASS');
    const tree = typeData('TREE');
    const weed = typeData('WEED');

    const topPlants = (today.plantInfo ?? [])
      .map((p): { name: string; index: number } | null => {
        const v = p.indexInfo?.value;
        if (typeof v !== 'number' || v <= 0) return null;
        return { name: p.displayName ?? '', index: v };
      })
      .filter((x): x is { name: string; index: number } => x !== null)
      .sort((a, b) => b.index - a.index)
      .slice(0, 4);

    // Surface advice from the highest-severity type — that's the one most
    // likely to be triggering symptoms today, so its recommendations are
    // the most relevant to act on. Tied severities prefer grass > tree > weed
    // (grass is the most common allergen).
    const tipsByPriority = [grass, tree, weed]
      .filter((t) => t.tips.length > 0)
      .sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
    const healthRecommendations = tipsByPriority[0]?.tips ?? [];

    return {
      grass: grass.value,
      tree: tree.value,
      weed: weed.value,
      grassInSeason: grass.inSeason,
      treeInSeason: tree.inSeason,
      weedInSeason: weed.inSeason,
      topPlants,
      healthRecommendations,
    };
  } catch (err) {
    console.warn('google pollen fetch failed', err);
    throw err;
  }
}

export async function fetchPollenSample(lat: number, lon: number, token: string | null): Promise<PollenSample | null> {
  // Always run Open-Meteo for PM2.5 + AQI (and the EU pollen fallback).
  const meteoPromise = fetchOpenMeteo(lat, lon);

  if (token) {
    // Errors from fetchGooglePollen (e.g. a rejected key) propagate so the
    // tile can show them to the user.
    const [meteo, google] = await Promise.all([meteoPromise, fetchGooglePollen(token, lat, lon)]);
    return buildPollenSample(google, meteo);
  }

  return buildPollenSample(null, await meteoPromise);
}

/** Pure Google-vs-Open-Meteo merge decision: Google wins when it returned
 *  data (Open-Meteo still supplies PM2.5/AQI); otherwise fall back to
 *  Open-Meteo's EU-only pollen fields; null when neither has anything. */
export function buildPollenSample(
  google: GooglePollenResult | null,
  meteo: OpenMeteoCurrent | null,
): PollenSample | null {
  if (google) {
    return {
      source: 'google',
      grass: google.grass,
      tree: google.tree,
      weed: google.weed,
      grassInSeason: google.grassInSeason,
      treeInSeason: google.treeInSeason,
      weedInSeason: google.weedInSeason,
      topPlants: google.topPlants,
      healthRecommendations: google.healthRecommendations,
      pm25: meteo?.pm2_5 ?? null,
      usAqi: meteo?.us_aqi ?? null,
      fetchedAt: Date.now() / 1000,
    };
  }

  if (!meteo) return null;

  // Open-Meteo fallback: bucket grain counts into the 0..5 scale. Tree =
  // max of birch + olive + alder; weed = max of ragweed + mugwort. EU-only —
  // returns null for non-European locations.
  const treeRaw = Math.max(meteo.birch_pollen ?? 0, meteo.olive_pollen ?? 0, meteo.alder_pollen ?? 0);
  const weedRaw = Math.max(meteo.ragweed_pollen ?? 0, meteo.mugwort_pollen ?? 0);
  const treeNullable = (meteo.birch_pollen == null && meteo.olive_pollen == null && meteo.alder_pollen == null)
    ? null : treeRaw;
  const weedNullable = (meteo.ragweed_pollen == null && meteo.mugwort_pollen == null)
    ? null : weedRaw;

  return {
    source: 'open-meteo',
    grass: bucketFromGrains(meteo.grass_pollen ?? null),
    tree: bucketFromGrains(treeNullable),
    weed: bucketFromGrains(weedNullable),
    // Open-Meteo doesn't report seasonality — leave null so the UI falls
    // back to the generic "none" label rather than guessing.
    grassInSeason: null,
    treeInSeason: null,
    weedInSeason: null,
    topPlants: [],
    healthRecommendations: [],
    pm25: meteo.pm2_5 ?? null,
    usAqi: meteo.us_aqi ?? null,
    fetchedAt: Date.now() / 1000,
  };
}

export interface PollenLevel {
  label: string;
  color: string;
}

/** Universal Pollen Index 0..5 → label + color. Matches Google's UPI scheme. */
export function pollenLevel(upi: number | null): PollenLevel {
  if (upi == null) return { label: '—', color: 'rgba(255,255,255,0.3)' };
  if (upi <= 0) return { label: 'none',      color: 'rgba(255,255,255,0.4)' };
  if (upi <= 1) return { label: 'very low',  color: '#22c55e' };
  if (upi <= 2) return { label: 'low',       color: '#84cc16' };
  if (upi <= 3) return { label: 'moderate',  color: '#facc15' };
  if (upi <= 4) return { label: 'high',      color: '#fb923c' };
  return { label: 'very high', color: '#ef4444' };
}

/** PM2.5 → smoke risk band. EPA/AirNow-aligned thresholds. */
export function smokeLevel(pm25: number | null): PollenLevel {
  if (pm25 == null) return { label: '—', color: 'rgba(255,255,255,0.3)' };
  if (pm25 < 12)   return { label: 'clean',    color: '#22c55e' };
  if (pm25 < 35)   return { label: 'moderate', color: '#facc15' };
  if (pm25 < 55)   return { label: 'unhealthy (sensitive)', color: '#fb923c' };
  if (pm25 < 150)  return { label: 'unhealthy', color: '#ef4444' };
  return { label: 'hazardous', color: '#a855f7' };
}
