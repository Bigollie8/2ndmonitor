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

// ─────────────────────────────────────────────────────────────────────────────
// Zoom without cancelling follow-mode (0.8.2).
//
// Before this, ANY view change became a full override, so one scroll wheel
// click permanently stopped a map tracking its anchor — the ISS tile stopped
// following the station, and the radar/aircraft maps stopped tracking the
// saved location. Zoom is now stored separately from a panned centre:
// `config.mapView` still means "the user panned here" and `config.mapZoom`
// means "the user chose this zoom while still following". Keeping them in
// separate keys leaves every existing saved blob parsing exactly as before.
// ─────────────────────────────────────────────────────────────────────────────

/** Parse a persisted `instance.config.mapZoom`. null = no zoom override. */
export function parseMapZoom(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return clampZoom(raw, MIN_TILE_Z, MAX_TILE_Z);
}

export type ViewChangeKind = 'zoom' | 'pan';

/** Was this view change a zoom or a pan?
 *
 *  `zoomAt` anchors zoom at the CURSOR, so a wheel event moves the centre as
 *  well as the zoom. A zoom delta therefore has to win: reading that centre
 *  shift as a pan is precisely what used to cancel follow-mode on the first
 *  scroll. Pan (`panBy`) never changes zoom, so the discriminator is exact. */
export function classifyViewChange(prev: MapViewState, next: MapViewState): ViewChangeKind {
  return Math.abs(next.zoom - prev.zoom) > 1e-9 ? 'zoom' : 'pan';
}
