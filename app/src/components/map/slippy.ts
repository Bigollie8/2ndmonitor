/** Pure Web-Mercator slippy-map math for the shared MapView canvas.
 *  No DOM — unit-tested under the node test runner.
 *  Formulas: https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames */

export const TILE_SIZE = 256;
/** Web-Mercator latitude limit — the projection cuts off at ±85.0511°. */
export const MAX_LAT = 85.05112878;
/** CARTO raster tiles exist for z 0..19. */
export const MIN_TILE_Z = 0;
export const MAX_TILE_Z = 19;

export interface LatLon { lat: number; lon: number }
export interface MapViewState { center: LatLon; zoom: number }

export function clampZoom(zoom: number, min: number, max: number): number {
  if (!Number.isFinite(zoom)) return min;
  return Math.min(max, Math.max(min, zoom));
}

export function clampLat(lat: number): number {
  return Math.min(MAX_LAT, Math.max(-MAX_LAT, lat));
}

/** Wrap longitude into [-180, 180). */
export function wrapLon(lon: number): number {
  return ((lon + 180) % 360 + 360) % 360 - 180;
}

/** World size in pixels at a (possibly fractional) zoom. */
function worldPx(zoom: number): number {
  return TILE_SIZE * Math.pow(2, zoom);
}

/** lat/lon → world pixel coordinates at `zoom` ((0,0) = north-west corner). */
export function latLonToWorld(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const n = worldPx(zoom);
  const latRad = clampLat(lat) * Math.PI / 180;
  return {
    x: (wrapLon(lon) + 180) / 360 * n,
    y: Math.max(0, (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n),
  };
}

/** Inverse of latLonToWorld. */
export function worldToLatLon(x: number, y: number, zoom: number): LatLon {
  const n = worldPx(zoom);
  return {
    lat: clampLat(Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI),
    lon: wrapLon(x / n * 360 - 180),
  };
}
