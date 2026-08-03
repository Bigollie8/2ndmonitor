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

/** Canvas px of a lat/lon for a view rendered in a w×h viewport. */
export function project(
  view: MapViewState, w: number, h: number, lat: number, lon: number,
): { x: number; y: number } {
  const c = latLonToWorld(view.center.lat, view.center.lon, view.zoom);
  const p = latLonToWorld(lat, lon, view.zoom);
  // Take the shorter way around the antimeridian so markers just past ±180°
  // don't land a world-width away from the center.
  const n = TILE_SIZE * Math.pow(2, view.zoom);
  let dx = p.x - c.x;
  if (dx > n / 2) dx -= n;
  if (dx < -n / 2) dx += n;
  return { x: w / 2 + dx, y: h / 2 + (p.y - c.y) };
}

/** Canvas px → lat/lon (inverse of project). */
export function unproject(
  view: MapViewState, w: number, h: number, x: number, y: number,
): LatLon {
  const c = latLonToWorld(view.center.lat, view.center.lon, view.zoom);
  return worldToLatLon(c.x + (x - w / 2), c.y + (y - h / 2), view.zoom);
}

/** Pointer-drag pan: the map content follows the pointer, so the center moves
 *  opposite to the drag delta (canvas px). */
export function panBy(view: MapViewState, dx: number, dy: number): MapViewState {
  const c = latLonToWorld(view.center.lat, view.center.lon, view.zoom);
  return { center: worldToLatLon(c.x - dx, c.y - dy, view.zoom), zoom: view.zoom };
}

/** Cursor-anchored wheel zoom: the lat/lon under `cursor` stays under it. */
export function zoomAt(
  view: MapViewState,
  zoomDelta: number,
  cursor: { x: number; y: number },
  viewport: { w: number; h: number },
  minZoom: number,
  maxZoom: number,
): MapViewState {
  const newZoom = clampZoom(view.zoom + zoomDelta, minZoom, maxZoom);
  if (newZoom === view.zoom) return view;
  const anchor = unproject(view, viewport.w, viewport.h, cursor.x, cursor.y);
  const a = latLonToWorld(anchor.lat, anchor.lon, newZoom);
  // Choose the new center so the anchor projects back onto the cursor.
  const center = worldToLatLon(
    a.x - (cursor.x - viewport.w / 2),
    a.y - (cursor.y - viewport.h / 2),
    newZoom,
  );
  return { center, zoom: newZoom };
}
