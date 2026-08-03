/** RainViewer free public radar API + slippy-map tile math.
 *  See https://www.rainviewer.com/api.html — no key required, public CORS allowed. */

export interface RainViewerFrame {
  /** Unix epoch seconds. */
  time: number;
  /** Tile path returned by the manifest, e.g. "/v2/radar/1714929000". */
  path: string;
}

export interface RainViewerManifest {
  /** Tile-cache host root, e.g. "https://tilecache.rainviewer.com". */
  host: string;
  /** Manifest generation time (Unix seconds). Used as React effect dep. */
  generated: number;
  /** Past radar frames (oldest → newest). Typically ~10 frames at 10-min cadence. */
  past: RainViewerFrame[];
  /** Forecast (nowcast) frames (current → future). Typically ~3 frames. */
  nowcast: RainViewerFrame[];
}

/** Convert longitude/latitude to slippy-map tile XY at integer zoom level.
 *  See https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames */
export function lonLatToTileXY(lon: number, lat: number, z: number): { x: number; y: number } {
  const n = 1 << z;
  const x = Math.floor((lon + 180) / 360 * n) % n;
  const latRad = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  return { x, y };
}

/** Fetch the RainViewer manifest. Returns null on network/parse error
 *  (callers should keep their last-known good manifest in those cases). */
export async function fetchRainViewerManifest(): Promise<RainViewerManifest | null> {
  try {
    const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (!data || typeof data !== 'object') return null;
    const d = data as { host?: unknown; generated?: unknown; radar?: { past?: unknown; nowcast?: unknown } };
    if (typeof d.host !== 'string') return null;
    return {
      host: d.host,
      generated: typeof d.generated === 'number' ? d.generated : 0,
      past: Array.isArray(d.radar?.past) ? (d.radar!.past as unknown[]).filter(isFrame) : [],
      nowcast: Array.isArray(d.radar?.nowcast) ? (d.radar!.nowcast as unknown[]).filter(isFrame) : [],
    };
  } catch (err) {
    console.warn('rainviewer manifest fetch failed', err);
    return null;
  }
}

function isFrame(x: unknown): x is RainViewerFrame {
  if (!x || typeof x !== 'object') return false;
  const f = x as { time?: unknown; path?: unknown };
  return typeof f.time === 'number' && typeof f.path === 'string';
}

/** Build the radar overlay tile URL for a specific frame.
 *  Color scheme `2` is "Universal Blue" — reads cleanly over the CARTO
 *  dark_matter basemap the shared MapView renders. Variant `1_1`: smooth +
 *  show snow. */
export function radarTileUrl(host: string, path: string, z: number, x: number, y: number): string {
  return `${host}${path}/256/${z}/${x}/${y}/2/1_1.png`;
}

// ── Radar loop controls (0.7.2 §1) ───────────────────────────────────────────
// RainViewer serves exactly 13 past frames at 10-min steps = 2 h hard max, so
// 120 is the ceiling; anything longer needs a different provider (parked).

export type RadarSpeed = 'slow' | 'normal' | 'fast';
export type RadarWindowMin = 30 | 60 | 120;

export interface RadarConfig {
  windowMin: RadarWindowMin;
  speed: RadarSpeed;
}

/** Frame cadence per speed. 'fast' is the pre-0.7.2 hardcoded 500 ms;
 *  'normal' (the new default) is the 1× feel. */
export const RADAR_SPEED_MS: Record<RadarSpeed, number> = { slow: 1200, normal: 800, fast: 500 };

/** Parse the tile's persisted `instance.config` blob. Same parse-with-fallback
 *  pattern as parseMapView / parseDateTimeConfig; the blob is SHARED with the
 *  map-view keys, so unknown keys are expected and ignored, and each field
 *  falls back independently. */
export function parseRadarConfig(raw: unknown): RadarConfig {
  const fallback: RadarConfig = { windowMin: 60, speed: 'normal' };
  if (!raw || typeof raw !== 'object') return fallback;
  const c = raw as { windowMin?: unknown; speed?: unknown };
  const windowMin: RadarWindowMin =
    c.windowMin === 30 || c.windowMin === 60 || c.windowMin === 120 ? c.windowMin : 60;
  const speed: RadarSpeed =
    c.speed === 'slow' || c.speed === 'normal' || c.speed === 'fast' ? c.speed : 'normal';
  return { windowMin, speed };
}

/** The loop window as a tail slice of the manifest's past frames (10-min
 *  cadence): 30 min → 4 frames, 1 h → 7, 2 h → 13 (all of them). */
export function radarFrameSlice<T>(past: T[], windowMin: RadarWindowMin): T[] {
  return past.slice(-(windowMin / 10 + 1));
}
