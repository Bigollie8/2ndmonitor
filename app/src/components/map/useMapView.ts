import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type MapViewState, clampZoom } from './slippy';
import { parseMapView, serializeMapView } from './mapConfig';

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
  const persist = useCallback((next: MapViewState | null) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const base = { ...(configRef.current ?? {}) };
      if (next) base.mapView = serializeMapView(next);
      else delete base.mapView;
      setConfigRef.current(base);
    }, PERSIST_DEBOUNCE_MS);
  }, []);

  const onViewChange = useCallback((next: MapViewState) => {
    const clamped: MapViewState = {
      center: next.center,
      zoom: clampZoom(next.zoom, minZoom, maxZoom),
    };
    setOverride(clamped);
    persist(clamped);
  }, [minZoom, maxZoom, persist]);

  const recenter = useCallback(() => {
    setOverride(null);
    persist(null);
  }, [persist]);

  const view = useMemo(
    () => override ?? {
      center: { lat: anchor.lat, lon: anchor.lon },
      zoom: clampZoom(defaultZoom, minZoom, maxZoom),
    },
    [override, anchor.lat, anchor.lon, defaultZoom, minZoom, maxZoom],
  );

  return {
    view,
    overridden: override != null,
    onViewChange,
    recenter,
  };
}
