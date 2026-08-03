import type { MapViewState } from './slippy';
import { clampZoom, MIN_TILE_Z, MAX_TILE_Z } from './slippy';

/** Parse a persisted `instance.config.mapView` blob. Returns null (meaning
 *  "no override — follow the tile's natural anchor") on anything malformed,
 *  matching the parse-with-fallback pattern of parseStreamDeckConfig in
 *  state/actions.ts. */
export function parseMapView(raw: unknown): MapViewState | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as { center?: unknown; zoom?: unknown };
  if (!v.center || typeof v.center !== 'object') return null;
  const c = v.center as { lat?: unknown; lon?: unknown };
  const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
  if (!num(c.lat) || !num(c.lon) || !num(v.zoom)) return null;
  if (c.lat < -90 || c.lat > 90 || c.lon < -180 || c.lon > 180) return null;
  return { center: { lat: c.lat, lon: c.lon }, zoom: clampZoom(v.zoom, MIN_TILE_Z, MAX_TILE_Z) };
}

export function serializeMapView(view: MapViewState): { center: { lat: number; lon: number }; zoom: number } {
  return { center: { lat: view.center.lat, lon: view.center.lon }, zoom: view.zoom };
}
