import React, { useEffect, useRef } from 'react';
import { type MapViewState, panBy, project, visibleTiles, zoomAt } from './slippy';

/** CARTO dark_matter raster basemap. CSP `img-src https:` already allows it;
 *  crossOrigin keeps the canvas untainted for compositing. */
export function baseTileUrl(z: number, x: number, y: number): string {
  return `https://basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`;
}

export type ProjectFn = (lat: number, lon: number) => { x: number; y: number };

// Two caches, deliberately (0.8.2). Base map tiles and radar-overlay frames
// used to share one 256-entry LRU, and the radar always won: a 2-hour loop is
// 13 frames x the tiles covering the viewport, which is ~195 URLs for an
// 800x500 tile and 260+ once the tile is 1000x650 — over the whole cap on its
// own. Playing the loop therefore evicted the BASE tiles of every mounted map
// on each cycle, so the basemap re-fetched constantly (the visible "glitching")
// and any tile that failed then sat blank for ERROR_RETRY_MS.
//
// Separating them means radar churn can never evict the basemap. The base cap
// is unchanged; the overlay cap is sized to hold a full loop at a large tile
// size so a cycling animation stops re-fetching what it just showed.
const TILE_CACHE_MAX = 256;
const OVERLAY_CACHE_MAX = 512;
/** After a failed load (post-retry) wait this long before trying again when
 *  the tile is next requested — "give up until it scrolls back into view". */
const ERROR_RETRY_MS = 15_000;
/** Wheel: one 120-unit notch = half a zoom level. */
const WHEEL_ZOOM_PER_PX = 1 / 240;
const MAP_BG = '#0b0d10';

interface CacheEntry {
  img: HTMLImageElement;
  status: 'loading' | 'ok' | 'error';
  retried: boolean;
  errorAt: number;
  /** Redraw callbacks of every MapView waiting on this tile. */
  waiters: Set<() => void>;
}

/** Module-level so every map tile shares one LRU. Map preserves insertion
 *  order; re-inserting on hit makes eviction least-recently-used. */
const tileCache = new Map<string, CacheEntry>();
/** Radar/overlay frames. Separate LRU so a playing loop cannot evict basemap
 *  tiles — see the cap comments above. */
const overlayCache = new Map<string, CacheEntry>();

function getTile(
  url: string,
  onSettled: () => void,
  cache: Map<string, CacheEntry> = tileCache,
  cap: number = TILE_CACHE_MAX,
): HTMLImageElement | null {
  const hit = cache.get(url);
  if (hit) {
    cache.delete(url);
    cache.set(url, hit); // refresh LRU position
    if (hit.status === 'ok') return hit.img;
    if (hit.status === 'error' && Date.now() - hit.errorAt > ERROR_RETRY_MS) {
      cache.delete(url); // cooldown over — fall through and reload
    } else {
      if (hit.status === 'loading') hit.waiters.add(onSettled);
      return null; // loading, or failed and still cooling down (dark background)
    }
  }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  const entry: CacheEntry = { img, status: 'loading', retried: false, errorAt: 0, waiters: new Set([onSettled]) };
  const settle = () => {
    for (const w of entry.waiters) w();
    entry.waiters.clear();
  };
  img.onload = () => { entry.status = 'ok'; settle(); };
  img.onerror = () => {
    if (!entry.retried) {
      entry.retried = true; // single retry
      img.src = '';
      img.src = url;
      return;
    }
    entry.status = 'error';
    entry.errorAt = Date.now();
    settle();
  };
  img.src = url;
  cache.set(url, entry);
  while (cache.size > cap) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return null;
}

export interface MapViewProps {
  view: MapViewState;
  onViewChange: (next: MapViewState) => void;
  minZoom: number;
  maxZoom: number;
  /** Drawn above the raster layers every frame. `projectPt` → canvas CSS px. */
  overlay?: (ctx: CanvasRenderingContext2D, projectPt: ProjectFn) => void;
  /** Optional raster overlay (radar frames), same slippy grid as the base. */
  overlayTileUrl?: ((z: number, x: number, y: number) => string) | null;
  overlayTileAlpha?: number;
  /** Streamer mode (0.7.1 §2): when true, draw NO base tiles, fetch nothing,
   *  and skip the overlay callback + raster overlay entirely — just the dark
   *  canvas and a centered "Hidden in streamer mode" label. */
  redacted?: boolean;
}

/** Canvas slippy map. Fills its nearest positioned ancestor. Pointer-drag
 *  pans (window-listener pattern shared with usePanelDrag in
 *  components/panelDrag.ts), wheel zooms anchored at the cursor, and all
 *  redraws are rAF-batched. */
function MapViewImpl({
  view, onViewChange, minZoom, maxZoom, overlay, overlayTileUrl, overlayTileAlpha = 0.7, redacted = false,
}: MapViewProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  // Cleanup for the in-flight drag's window listeners (see onPointerDown),
  // so an unmount mid-drag doesn't leak them until the next pointerup.
  const dragCleanupRef = useRef<(() => void) | null>(null);
  // Refs so window/rAF callbacks always see the latest values without rebinding.
  const viewRef = useRef(view); viewRef.current = view;
  const onViewChangeRef = useRef(onViewChange); onViewChangeRef.current = onViewChange;
  const overlayRef = useRef(overlay); overlayRef.current = overlay;
  const overlayTileUrlRef = useRef(overlayTileUrl); overlayTileUrlRef.current = overlayTileUrl;
  const overlayTileAlphaRef = useRef(overlayTileAlpha); overlayTileAlphaRef.current = overlayTileAlpha;
  const redactedRef = useRef(redacted); redactedRef.current = redacted;

  const drawRef = useRef<() => void>(() => {});
  drawRef.current = () => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (w === 0 || h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = MAP_BG;
    ctx.fillRect(0, 0, w, h);
    // Redacted: dark canvas only. Returning before visibleTiles means no
    // getTile call, so nothing is fetched — not merely not drawn.
    if (redactedRef.current) return;
    const v = viewRef.current;
    const tiles = visibleTiles(v, w, h);
    const schedule = scheduleDraw;
    for (const t of tiles) {
      const img = getTile(baseTileUrl(t.z, t.x, t.y), schedule);
      if (img) ctx.drawImage(img, t.sx, t.sy, t.size, t.size);
    }
    const urlFn = overlayTileUrlRef.current;
    if (urlFn) {
      ctx.globalAlpha = overlayTileAlphaRef.current;
      for (const t of tiles) {
        // Overlay cache, NOT the base cache — a playing radar loop must never
        // be able to evict the basemap out from under itself.
        const img = getTile(urlFn(t.z, t.x, t.y), schedule, overlayCache, OVERLAY_CACHE_MAX);
        if (img) ctx.drawImage(img, t.sx, t.sy, t.size, t.size);
      }
      ctx.globalAlpha = 1;
    }
    const ov = overlayRef.current;
    if (ov) {
      ctx.save();
      ov(ctx, (lat, lon) => project(v, w, h, lat, lon));
      ctx.restore();
    }
  };

  const scheduleDraw = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      drawRef.current();
    });
  };

  // Any prop change (view, overlay closure, radar frame) lands here after
  // commit; scheduleDraw coalesces bursts into one rAF paint.
  useEffect(() => { scheduleDraw(); });

  // Resize → repaint; cancel any pending frame on unmount.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => scheduleDraw());
    ro.observe(wrap);
    return () => {
      ro.disconnect();
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0; // StrictMode remounts synchronously; a stale non-zero
        // handle here makes scheduleDraw's guard think a frame is still pending.
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wheel zoom. Native listener with passive:false — React's synthetic wheel
  // handler can be passive, and preventDefault must work here.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const next = zoomAt(
        viewRef.current,
        -e.deltaY * WHEEL_ZOOM_PER_PX,
        { x: e.clientX - rect.left, y: e.clientY - rect.top },
        { w: rect.width, h: rect.height },
        minZoom,
        maxZoom,
      );
      if (next !== viewRef.current) onViewChangeRef.current(next);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [minZoom, maxZoom]);

  // Pointer-drag pan — same window-listener pattern as usePanelDrag.
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    let last = { x: e.clientX, y: e.clientY };
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - last.x;
      const dy = ev.clientY - last.y;
      last = { x: ev.clientX, y: ev.clientY };
      if (dx === 0 && dy === 0) return;
      onViewChangeRef.current(panBy(viewRef.current, dx, dy));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      dragCleanupRef.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    dragCleanupRef.current = up;
    e.preventDefault();
  };

  // Unmount mid-drag: run whatever drag is in flight's own cleanup so the
  // window listeners it added don't outlive this MapView.
  useEffect(() => {
    return () => dragCleanupRef.current?.();
  }, []);

  return (
    <div ref={wrapRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: MAP_BG }}>
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          display: 'block', cursor: 'grab', touchAction: 'none',
        }}
      />
      {/* License requirement: always-visible attribution. */}
      <div style={{
        position: 'absolute', right: 3, bottom: 2,
        fontSize: 8, lineHeight: 1.4, letterSpacing: 0.2,
        color: 'rgba(255,255,255,0.45)',
        background: 'rgba(0,0,0,0.35)',
        padding: '0 4px', borderRadius: 3,
        pointerEvents: 'none', userSelect: 'none',
      }}>
        © OpenStreetMap © CARTO
      </div>
      {redacted && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none', userSelect: 'none',
        }}>
          <span style={{
            fontSize: 11, lineHeight: 1.4, letterSpacing: 0.2,
            color: 'rgba(255,255,255,0.45)',
            background: 'rgba(0,0,0,0.35)',
            padding: '2px 8px', borderRadius: 3,
          }}>
            Hidden in streamer mode
          </span>
        </div>
      )}
    </div>
  );
}

/** Memoised (0.7.3 P4/P5): the redraw effect above has no dependency array, so
 *  ANY render of this component repaints the canvas. Host tiles re-render on
 *  every poll tick and on every unrelated tweak change, which meant all four
 *  map canvases repainted for reasons that had nothing to do with the map.
 *  Bailing out here is what stops that — it relies on useMapView returning a
 *  stable `view`/`onViewChange` and on hosts passing a stable `overlay`. */
export const MapView = React.memo(MapViewImpl);

/** Shown by host tiles when the view is panned/zoomed off its anchor. Place
 *  inside the same positioned ancestor as the MapView. */
export function RecenterButton({ accent, onClick }: { accent: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Recenter map"
      style={{
        position: 'absolute', top: 6, right: 6, zIndex: 2,
        padding: '3px 8px', fontSize: 10, fontWeight: 600, borderRadius: 5,
        // stays opaque-dark: floats over map canvas (glass Sweep Map exclusion)
        background: 'rgba(8,9,12,0.78)', color: accent,
        border: `1px solid ${accent}55`, cursor: 'pointer',
      }}
    >
      ⌖ recenter
    </button>
  );
}
