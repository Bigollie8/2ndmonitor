import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type MapViewState, clampZoom } from './slippy';
import { parseMapView, serializeMapView, parseMapZoom, classifyViewChange } from './mapConfig';

/** Dragging fires onViewChange per pointermove — debounce writes so the
 *  layout store isn't hammered mid-gesture. */
const PERSIST_DEBOUNCE_MS = 800;

export interface UseMapViewOpts {
  /** The tile's natural center (weather location, or live ISS position). */
  anchor: { lat: number; lon: number };
  defaultZoom: number;
  minZoom: number;
  maxZoom: number;
  config: Record<string, unknown> | undefined;
  setConfig: (next: Record<string, unknown>) => void;
}

export interface UseMapViewResult {
  view: MapViewState;
  /** True when the user has panned/zoomed off the anchor (show recenter). */
  overridden: boolean;
  onViewChange: (next: MapViewState) => void;
  recenter: () => void;
}

/** Anchor-or-override view state for a map tile. No override → the view
 *  tracks the anchor live (the ISS tile follows the station). Any user
 *  pan/zoom becomes an override, debounce-persisted to `config.mapView`;
 *  recenter clears it. */
export function useMapView(opts: UseMapViewOpts): UseMapViewResult {
  const { anchor, defaultZoom, minZoom, maxZoom, config, setConfig } = opts;
  const [override, setOverride] = useState<MapViewState | null>(() =>
    parseMapView(config ? (config as { mapView?: unknown }).mapView : undefined),
  );
  /** Zoom chosen while still following the anchor (0.8.2). Separate from
   *  `override` so zooming does not cancel follow-mode. */
  const [zoomOnly, setZoomOnly] = useState<number | null>(() =>
    parseMapZoom(config ? (config as { mapZoom?: unknown }).mapZoom : undefined),
  );
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const configRef = useRef(config); configRef.current = config;
  const setConfigRef = useRef(setConfig); setConfigRef.current = setConfig;

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  // Everything returned below is referentially stable (0.7.3 P4/P5). MapView
  // repaints its canvas on every render by design, so a fresh `view` object or
  // a fresh callback each render meant an unrelated parent re-render repainted
  // every map. `persist` reads config/setConfig through refs, so it needs no
  // deps of its own.
  const persist = useCallback((next: MapViewState | null, zoom: number | null) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const base = { ...(configRef.current ?? {}) };
      if (next) base.mapView = serializeMapView(next);
      else delete base.mapView;
      if (zoom != null) base.mapZoom = zoom;
      else delete base.mapZoom;
      setConfigRef.current(base);
    }, PERSIST_DEBOUNCE_MS);
  }, []);

  const view = useMemo(
    () => override ?? {
      center: { lat: anchor.lat, lon: anchor.lon },
      zoom: clampZoom(zoomOnly ?? defaultZoom, minZoom, maxZoom),
    },
    [override, zoomOnly, anchor.lat, anchor.lon, defaultZoom, minZoom, maxZoom],
  );

  // Read the live view/override inside onViewChange without making either a
  // dep — the callback must stay referentially stable or the memoised MapView
  // (0.7.3 P4/P5) starts re-rendering, which means repainting, on every
  // override change.
  const viewRef = useRef(view); viewRef.current = view;
  const overrideRef = useRef(override); overrideRef.current = override;

  const onViewChange = useCallback((next: MapViewState) => {
    const zoom = clampZoom(next.zoom, minZoom, maxZoom);
    const kind = classifyViewChange(viewRef.current, next);
    const override = overrideRef.current;

    // Zooming while still following keeps following: adopt the new zoom but
    // stay pinned to the anchor, discarding the cursor-anchored centre shift
    // zoomAt() produced. Before 0.8.2 this became a full override and the map
    // silently stopped tracking (ISS stopped following the station).
    if (kind === 'zoom' && override == null) {
      setZoomOnly(zoom);
      persist(null, zoom);
      return;
    }

    // A pan — or a zoom once already panned — is a real centre override.
    const clamped: MapViewState = { center: next.center, zoom };
    setOverride(clamped);
    setZoomOnly(null);
    persist(clamped, null);
  }, [minZoom, maxZoom, persist]);

  const recenter = useCallback(() => {
    setOverride(null);
    setZoomOnly(null);
    persist(null, null);
  }, [persist]);

  return {
    view,
    // The recenter affordance appears for either kind of override, so a user
    // who only zoomed can still get back to the default framing.
    overridden: override != null || zoomOnly != null,
    onViewChange,
    recenter,
  };
}
