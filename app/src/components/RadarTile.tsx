import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { HFTile } from './tiles';
import { MapView, RecenterButton, type ProjectFn } from './map/MapView';
import { drawHomeDot } from './map/homeDot';
import { useMapView } from './map/useMapView';
import {
  type RainViewerFrame,
  type RainViewerManifest,
  fetchRainViewerManifest,
  radarTileUrl,
  parseRadarConfig,
  radarFrameSlice,
  RADAR_SPEED_MS,
  type RadarSpeed,
} from '../state/rainviewer';
import { usePoll } from '../state/usePoll';
import { formatClock } from '../state/dateTime';
import type { Density, WeatherLocation } from '../types';

const MANIFEST_REFRESH_MS = 5 * 60 * 1000;
/** Spec: radar frames overlay at a fixed 0.7 opacity. */
const RADAR_OPACITY = 0.7;
const MAP_MIN_ZOOM = 3;
const MAP_MAX_ZOOM = 12;
const MAP_DEFAULT_ZOOM = 7;

export interface RadarTileProps {
  density: Density;
  accent: string;
  location: WeatherLocation;
  config: Record<string, unknown> | undefined;
  setConfig: (next: Record<string, unknown>) => void;
  /** Streamer mode (0.7.1 §2): blanks the map — see MapView.redacted. */
  redacted?: boolean;
  /** Resolved platform clock format (0.7.2 §3). */
  hour12: boolean;
}

function RadarTileImpl({ density, accent, location, config, setConfig, redacted = false, hour12 }: RadarTileProps) {
  const [frameIndex, setFrameIndex] = useState<number>(0);
  // Spec: latest frame by default; the play button starts the animation.
  const [playing, setPlaying] = useState<boolean>(false);
  const [scrubbing, setScrubbing] = useState<boolean>(false);

  const radarCfg = parseRadarConfig(config);
  const [hovered, setHovered] = useState(false);

  // Manifest fetch: on mount + every 5 minutes. Returns null on failure —
  // throw so usePoll backs off and keeps the last good manifest visible.
  const { data: manifest } = usePoll(
    async () => {
      const m = await fetchRainViewerManifest();
      if (m == null) throw new Error('fetch failed');
      return m;
    },
    MANIFEST_REFRESH_MS,
    [],
  );

  /** The configured loop window of past frames, oldest → newest. */
  const frames: RainViewerFrame[] = useMemo(
    () => (manifest ? radarFrameSlice(manifest.past, radarCfg.windowMin) : []),
    [manifest, radarCfg.windowMin],
  );

  // Clamp for render: frameIndex can momentarily point past the end when the
  // window shrinks (e.g. 2h→30m while parked at the last frame) — the effect
  // below reconciles frameIndex itself on the next tick, but the render in
  // between must never index frames[] out of range (that would null out
  // currentFrame, unmount the whole footer, and flash the overlay off).
  const shownIndex = Math.min(frameIndex, Math.max(0, frames.length - 1));
  const currentFrame = frames[shownIndex];

  const { view, overridden, onViewChange, recenter } = useMapView({
    anchor: { lat: location.lat, lon: location.lon },
    defaultZoom: MAP_DEFAULT_ZOOM,
    minZoom: MAP_MIN_ZOOM,
    maxZoom: MAP_MAX_ZOOM,
    config,
    setConfig,
  });

  const overlayTileUrl = useMemo(() => {
    if (!manifest || !currentFrame) return null;
    const host = manifest.host;
    const path = currentFrame.path;
    return (z: number, x: number, y: number) => radarTileUrl(host, path, z, x, y);
  }, [manifest, currentFrame]);

  // Stale-while-loading + prefetch (0.8.7): on a slow link the loop used to
  // advance onto frames whose tiles hadn't arrived, so the overlay popped
  // holes every step — the NZ "glitching" report. The previous frame fills a
  // not-yet-loaded tile's spot, and the next frame is warmed while the
  // current one is on screen (playing only — a paused radar shouldn't fetch).
  const prevFrame = frames.length > 1
    ? frames[(shownIndex - 1 + frames.length) % frames.length]
    : undefined;
  const overlayTilePrevUrl = useMemo(() => {
    if (!manifest || !prevFrame) return null;
    const host = manifest.host;
    const path = prevFrame.path;
    return (z: number, x: number, y: number) => radarTileUrl(host, path, z, x, y);
  }, [manifest, prevFrame]);

  const nextFrame = playing && frames.length > 1
    ? frames[(shownIndex + 1) % frames.length]
    : undefined;
  const overlayTilePrefetchUrl = useMemo(() => {
    if (!manifest || !nextFrame) return null;
    const host = manifest.host;
    const path = nextFrame.path;
    return (z: number, x: number, y: number) => radarTileUrl(host, path, z, x, y);
  }, [manifest, nextFrame]);

  // Auto-advance frames when playing AND not scrubbing.
  useEffect(() => {
    if (!playing || scrubbing || frames.length === 0) return;
    const id = setInterval(() => {
      if (document.hidden) return;
      setFrameIndex((i) => (i + 1) % frames.length);
    }, RADAR_SPEED_MS[radarCfg.speed]);
    return () => clearInterval(id);
  }, [playing, scrubbing, frames.length, radarCfg.speed]);

  // Snap to the newest frame when a new manifest arrives or the window changes.
  useEffect(() => {
    setFrameIndex(Math.max(0, frames.length - 1));
  }, [manifest?.generated, frames.length]);

  const headRight = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{
        fontSize: 10, color: 'rgba(255,255,255,0.55)',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      }}>{location.label}</span>
      <button
        onClick={() => setPlaying((p) => !p)}
        title={playing ? 'Pause' : `Play the last ${radarCfg.windowMin === 30 ? '30 minutes' : radarCfg.windowMin === 60 ? 'hour' : '2 hours'}`}
        style={{
          padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 5,
          background: playing ? `${accent}22` : 'rgba(255,255,255,0.05)',
          color: playing ? accent : 'rgba(255,255,255,0.7)',
          border: playing ? `1px solid ${accent}55` : '1px solid rgba(255,255,255,0.08)',
          cursor: 'pointer',
        }}
      >
        {playing ? '⏸' : '▶'}
      </button>
    </div>
  );

  const hasFrames = frames.length > 0;

  // The saved-location dot — the one thing radar was missing versus the other
  // three map tiles (0.7.3). Stable identity so the memoised MapView can bail
  // out when nothing about the map changed.
  const drawHome = useCallback(
    (ctx: CanvasRenderingContext2D, projectPt: ProjectFn) => {
      drawHomeDot(ctx, projectPt, location.lat, location.lon);
    },
    [location.lat, location.lon],
  );

  return (
    <HFTile title="Weather radar" headRight={headRight} accent={accent} density={density} style={{ height: '100%' }}>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', flexDirection: 'column',
          width: '100%', height: '100%', minHeight: 0,
        }}>
        {/* Pannable/zoomable map with the radar frame composited at 0.7. */}
        <div style={{ flex: 1, minHeight: 0, position: 'relative', borderRadius: 6, overflow: 'hidden' }}>
          <MapView
            view={view}
            onViewChange={onViewChange}
            minZoom={MAP_MIN_ZOOM}
            maxZoom={MAP_MAX_ZOOM}
            overlayTileUrl={overlayTileUrl}
            overlayTilePrevUrl={overlayTilePrevUrl}
            overlayTilePrefetchUrl={overlayTilePrefetchUrl}
            overlayTileAlpha={RADAR_OPACITY}
            overlay={drawHome}
            redacted={redacted}
          />
          {overridden && <RecenterButton accent={accent} onClick={recenter} />}
          {!manifest && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              // stays opaque-dark: floats over map canvas (glass Sweep Map exclusion)
              background: 'rgba(8,9,12,0.6)',
              fontSize: 11, color: 'rgba(255,255,255,0.55)',
              pointerEvents: 'none',
            }}>
              Loading radar…
            </div>
          )}
          {manifest && !hasFrames && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              // stays opaque-dark: floats over map canvas (glass Sweep Map exclusion)
              background: 'rgba(8,9,12,0.6)',
              fontSize: 11, color: 'rgba(255,255,255,0.55)',
              pointerEvents: 'none',
            }}>
              No radar data available
            </div>
          )}
        </div>

        {/* Footer: timestamp + scrub slider over the last hour */}
        {hasFrames && currentFrame && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '6px 4px 0',
          }}>
            <span data-testid="radar-frame-time" style={{
              fontSize: 10, color: 'rgba(255,255,255,0.6)',
              fontFamily: '"JetBrains Mono", ui-monospace, monospace',
              flexShrink: 0, minWidth: 110,
            }}>
              {formatFrameTime(currentFrame, manifest, hour12)}
            </span>
            {hovered && (
              <>
                <FooterSeg<'30' | '60' | '120'>
                  value={String(radarCfg.windowMin) as '30' | '60' | '120'}
                  options={['30', '60', '120']}
                  labels={{ '30': '30m', '60': '1h', '120': '2h' }}
                  onChange={(o) => setConfig({ ...(config ?? {}), windowMin: Number(o) })}
                  accent={accent}
                  testId="radar-window"
                />
                <FooterSeg<RadarSpeed>
                  value={radarCfg.speed}
                  options={['slow', 'normal', 'fast']}
                  labels={{ slow: '0.5×', normal: '1×', fast: '1.5×' }}
                  onChange={(s) => setConfig({ ...(config ?? {}), speed: s })}
                  accent={accent}
                  testId="radar-speed"
                />
              </>
            )}
            <input
              type="range"
              min={0}
              max={frames.length - 1}
              value={shownIndex}
              onMouseDown={() => setScrubbing(true)}
              onMouseUp={() => setScrubbing(false)}
              onTouchStart={() => setScrubbing(true)}
              onTouchEnd={() => setScrubbing(false)}
              onChange={(e) => setFrameIndex(parseInt(e.target.value, 10))}
              style={{
                flex: 1, height: 4,
                accentColor: accent,
              }}
            />
          </div>
        )}
      </div>
    </HFTile>
  );
}

/** Format frame time as "3:42 PM · -10 min" / "now" relative to the newest
 *  past frame ("now" boundary). `frames` only ever holds past frames (see
 *  `frames` above), so the offset is always ≤ 0 — never a future "+X min". */
function formatFrameTime(frame: RainViewerFrame, manifest: RainViewerManifest | null, hour12: boolean): string {
  if (!manifest) return '';
  const timeStr = formatClock(frame.time * 1000, { hour12 });

  const lastPast = manifest.past[manifest.past.length - 1];
  if (!lastPast) return timeStr;
  const offsetMin = Math.round((frame.time - lastPast.time) / 60);
  const suffix = offsetMin === 0 ? 'now' : `${offsetMin} min`;

  return `${timeStr} · ${suffix}`;
}

/** Tiny inline segmented control for the tile footer (0.7.2 §1). Settings'
 *  Segmented isn't exported and is styled for the settings window. */
function FooterSeg<T extends string>({ value, options, labels, onChange, accent, testId }: {
  value: T;
  options: T[];
  labels: Record<T, string>;
  onChange: (v: T) => void;
  accent: string;
  testId: string;
}) {
  return (
    <div data-testid={testId} style={{
      display: 'flex', gap: 2, padding: 1, borderRadius: 5, flexShrink: 0,
      background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)',
    }}>
      {options.map((o) => {
        const active = o === value;
        return (
          <button
            key={o}
            onClick={() => onChange(o)}
            style={{
              padding: '2px 6px', fontSize: 9, borderRadius: 4,
              fontFamily: '"JetBrains Mono", ui-monospace, monospace',
              fontWeight: active ? 600 : 400,
              background: active ? `${accent}22` : 'transparent',
              border: active ? `1px solid ${accent}44` : '1px solid transparent',
              color: active ? accent : 'rgba(255,255,255,0.5)',
              cursor: 'pointer',
            }}
          >{labels[o]}</button>
        );
      })}
    </div>
  );
}

/** Memoised (0.7.3 P2): App re-renders on any tweak change, and this tile's
 *  props are primitives or stable identities, so it can bail out. */
export const RadarTile = React.memo(RadarTileImpl);
