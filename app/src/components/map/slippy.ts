/** Pure Web-Mercator slippy-map math for the shared MapView canvas.
 *  No DOM — unit-tested under the node test runner.
 *  Formulas: https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames */

export const TILE_SIZE = 256;
/** Web-Mercator latitude limit — the projection cuts off at ±85.0511°. */
export const MAX_LAT = 85.05112878;
/** Deepest tile the basemap provider actually serves (see ./basemap.ts —
 *  Esri's dark canvas carries data to z16; CARTO went to z19 before it went
 *  key-only in 0.9.18). `visibleTiles` scales this level for any deeper view
 *  zoom, so a host tile's maxZoom can still exceed it. */
export const MIN_TILE_Z = 0;
export const MAX_TILE_Z = 16;

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

export interface TileOnScreen {
  z: number;
  x: number;
  y: number;
  /** Top-left corner of the tile on the canvas, CSS px. */
  sx: number;
  sy: number;
  /** On-screen edge length in CSS px (256 × 2^(zoom - z)). */
  size: number;
}

/** Enumerate the base tiles covering a w×h viewport. Tiles come from the
 *  integer zoom nearest the fractional view zoom, scaled to fit. X wraps
 *  around the antimeridian; Y is clipped at the poles. */
export function visibleTiles(view: MapViewState, w: number, h: number): TileOnScreen[] {
  const tileZ = Math.min(MAX_TILE_Z, Math.max(MIN_TILE_Z, Math.round(view.zoom)));
  const scale = Math.pow(2, view.zoom - tileZ);
  const size = TILE_SIZE * scale;
  const n = 1 << tileZ;
  const c = latLonToWorld(view.center.lat, view.center.lon, tileZ);
  // Visible world-px range at tileZ (canvas px / scale = world px).
  const x0 = Math.floor((c.x - (w / 2) / scale) / TILE_SIZE);
  const x1 = Math.ceil((c.x + (w / 2) / scale) / TILE_SIZE) - 1;
  const y0 = Math.max(0, Math.floor((c.y - (h / 2) / scale) / TILE_SIZE));
  const y1 = Math.min(n - 1, Math.ceil((c.y + (h / 2) / scale) / TILE_SIZE) - 1);
  const tiles: TileOnScreen[] = [];
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      tiles.push({
        z: tileZ,
        x: ((tx % n) + n) % n,
        y: ty,
        sx: w / 2 + (tx * TILE_SIZE - c.x) * scale,
        sy: h / 2 + (ty * TILE_SIZE - c.y) * scale,
        size,
      });
    }
  }
  return tiles;
}
