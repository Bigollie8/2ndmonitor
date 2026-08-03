import React, { useEffect, useMemo, useState } from 'react';
import { HFTile } from './tiles';
import { MapView, RecenterButton } from './map/MapView';
import { useMapView } from './map/useMapView';
import {
  type RainViewerFrame,
  type RainViewerManifest,
  fetchRainViewerManifest,
  radarTileUrl,
} from '../state/rainviewer';
import { usePoll } from '../state/usePoll';
import type { Density, WeatherLocation } from '../types';

const FRAME_INTERVAL_MS = 500;
const MANIFEST_REFRESH_MS = 5 * 60 * 1000;
/** RainViewer past frames arrive at 10-min cadence — the last 7 cover the
 *  last hour (spec: play button animates the last hour). */
const LAST_HOUR_FRAMES = 7;
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
}

export function RadarTile({ density, accent, location, config, setConfig }: RadarTileProps) {
  const [frameIndex, setFrameIndex] = useState<number>(0);
  // Spec: latest frame by default; the play button starts the animation.
  const [playing, setPlaying] = useState<boolean>(false);
  const [scrubbing, setScrubbing] = useState<boolean>(false);

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

  /** The last hour of past frames, oldest → newest (newest = "now"). */
  const frames: RainViewerFrame[] = useMemo(
    () => (manifest ? manifest.past.slice(-LAST_HOUR_FRAMES) : []),
    [manifest],
  );

  const currentFrame = frames[frameIndex];

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

  // Auto-advance frames when playing AND not scrubbing.
  useEffect(() => {
    if (!playing || scrubbing || frames.length === 0) return;
    const id = setInterval(() => {
      if (document.hidden) return;
      setFrameIndex((i) => (i + 1) % frames.length);
    }, FRAME_INTERVAL_MS);
    return () => clearInterval(id);
  }, [playing, scrubbing, frames.length]);

  // Snap to the latest frame when a new manifest arrives.
  useEffect(() => {
    if (!manifest) return;
    setFrameIndex(Math.max(0, Math.min(LAST_HOUR_FRAMES, manifest.past.length) - 1));
  }, [manifest?.generated]);

  const headRight = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{
        fontSize: 10, color: 'rgba(255,255,255,0.55)',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      }}>{location.label}</span>
      <button
        onClick={() => setPlaying((p) => !p)}
        title={playing ? 'Pause' : 'Play the last hour'}
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

  return (
    <HFTile title="Weather radar" headRight={headRight} accent={accent} density={density} style={{ height: '100%' }}>
      <div style={{
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
            overlayTileAlpha={RADAR_OPACITY}
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
            <span style={{
              fontSize: 10, color: 'rgba(255,255,255,0.6)',
              fontFamily: '"JetBrains Mono", ui-monospace, monospace',
              flexShrink: 0, minWidth: 110,
            }}>
              {formatFrameTime(currentFrame, manifest)}
            </span>
            <input
              type="range"
              min={0}
              max={frames.length - 1}
              value={frameIndex}
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
function formatFrameTime(frame: RainViewerFrame, manifest: RainViewerManifest | null): string {
  if (!manifest) return '';
  const dt = new Date(frame.time * 1000);
  const timeStr = dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  const lastPast = manifest.past[manifest.past.length - 1];
  if (!lastPast) return timeStr;
  const offsetMin = Math.round((frame.time - lastPast.time) / 60);
  const suffix = offsetMin === 0 ? 'now' : `${offsetMin} min`;

  return `${timeStr} · ${suffix}`;
}
