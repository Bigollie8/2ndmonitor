import React, { useEffect, useMemo, useState } from 'react';
import { HFTile } from './tiles';
import {
  type RainViewerFrame,
  type RainViewerManifest,
  basemapTileUrl,
  fetchRainViewerManifest,
  radarTileUrl,
} from '../state/rainviewer';
import type { Density, WeatherLocation } from '../types';

const RADAR_Z = 7;
const FRAME_INTERVAL_MS = 500;
const MANIFEST_REFRESH_MS = 5 * 60 * 1000;

/** 2×2 tile grid centered on a lat/lon. Returns the four tile coordinates
 *  (top-left, top-right, bottom-left, bottom-right). User's exact position
 *  ends up close to the geometric center of the rendered grid. */
function centeredTileGrid(lat: number, lon: number, z: number): Array<{ x: number; y: number }> {
  const n = 1 << z;
  const xFrac = (lon + 180) / 360 * n;
  const latRad = lat * Math.PI / 180;
  const yFrac = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;
  // Top-left tile: pick so user is closest to grid center. floor(x - 0.5) does this.
  const tx0 = Math.floor(xFrac - 0.5);
  const ty0 = Math.floor(yFrac - 0.5);
  return [
    { x: tx0,     y: ty0     },
    { x: tx0 + 1, y: ty0     },
    { x: tx0,     y: ty0 + 1 },
    { x: tx0 + 1, y: ty0 + 1 },
  ];
}

export interface RadarTileProps {
  density: Density;
  accent: string;
  location: WeatherLocation;
}

export function RadarTile({ density, accent, location }: RadarTileProps) {
  const [manifest, setManifest] = useState<RainViewerManifest | null>(null);
  const [frameIndex, setFrameIndex] = useState<number>(0);
  const [playing, setPlaying] = useState<boolean>(true);
  const [scrubbing, setScrubbing] = useState<boolean>(false);

  const frames: RainViewerFrame[] = useMemo(
    () => (manifest ? [...manifest.past, ...manifest.nowcast] : []),
    [manifest],
  );

  const tileGrid = useMemo(
    () => centeredTileGrid(location.lat, location.lon, RADAR_Z),
    [location.lat, location.lon],
  );

  const currentFrame = frames[frameIndex];

  // Manifest fetch: on mount + every 5 minutes
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const m = await fetchRainViewerManifest();
      if (cancelled) return;
      if (m) setManifest(m);
    };
    void load();
    const id = setInterval(load, MANIFEST_REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Auto-advance frames when playing AND not scrubbing
  useEffect(() => {
    if (!playing || scrubbing || frames.length === 0) return;
    const id = setInterval(() => {
      setFrameIndex((i) => (i + 1) % frames.length);
    }, FRAME_INTERVAL_MS);
    return () => clearInterval(id);
  }, [playing, scrubbing, frames.length]);

  // Reset frame index near "now" (last past frame) when manifest changes
  useEffect(() => {
    if (!manifest) return;
    const lastPast = manifest.past.length - 1;
    setFrameIndex(Math.max(0, lastPast));
  }, [manifest?.generated]);

  const headRight = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{
        fontSize: 10, color: 'rgba(255,255,255,0.55)',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      }}>{location.label}</span>
      <button
        onClick={() => setPlaying((p) => !p)}
        title={playing ? 'Pause' : 'Play'}
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
        {/* Map area: square 2×2 tile grid centered on user, letterboxed to fit
         *  whatever non-square space the tile rect provides. The square sizes
         *  itself to min(parentWidth, parentHeight) via container query units
         *  — `aspect-ratio` alone won't shrink the box when only height is
         *  constrained, which leaves the grid distorted. */}
        <div style={{
          flex: 1, minHeight: 0, position: 'relative',
          containerType: 'size',
          display: 'grid', placeItems: 'center',
          overflow: 'hidden',
        }}>
          <div style={{
            width: 'min(100cqw, 100cqh)',
            height: 'min(100cqw, 100cqh)',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gridTemplateRows: '1fr 1fr',
            gap: 0,
            borderRadius: 6, overflow: 'hidden',
            position: 'relative',
          }}>
            {tileGrid.map((tile) => (
              <div key={`${tile.x},${tile.y}`} style={{ position: 'relative', overflow: 'hidden' }}>
                <img
                  src={basemapTileUrl(RADAR_Z, tile.x, tile.y)}
                  alt=""
                  style={{
                    position: 'absolute', inset: 0,
                    width: '100%', height: '100%',
                    objectFit: 'fill',
                    pointerEvents: 'none',
                  }}
                />
                {manifest && currentFrame && (
                  <img
                    src={radarTileUrl(manifest.host, currentFrame.path, RADAR_Z, tile.x, tile.y)}
                    alt=""
                    style={{
                      position: 'absolute', inset: 0,
                      width: '100%', height: '100%',
                      objectFit: 'fill',
                      pointerEvents: 'none',
                      imageRendering: 'pixelated',
                    }}
                  />
                )}
              </div>
            ))}
            {!manifest && (
              <div style={{
                position: 'absolute', inset: 0,
                gridColumn: '1 / -1', gridRow: '1 / -1',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(8,9,12,0.6)',
                fontSize: 11, color: 'rgba(255,255,255,0.55)',
              }}>
                Loading radar…
              </div>
            )}
            {manifest && !hasFrames && (
              <div style={{
                position: 'absolute', inset: 0,
                gridColumn: '1 / -1', gridRow: '1 / -1',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(8,9,12,0.6)',
                fontSize: 11, color: 'rgba(255,255,255,0.55)',
              }}>
                No radar data available
              </div>
            )}
          </div>
        </div>

        {/* Footer: timestamp + slider */}
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

/** Format frame time as "3:42 PM · -10 min" / "now" / "+10 min" relative to
 *  the manifest's "now" boundary (last past frame). */
function formatFrameTime(frame: RainViewerFrame, manifest: RainViewerManifest | null): string {
  if (!manifest) return '';
  const dt = new Date(frame.time * 1000);
  const timeStr = dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  // Last past frame = "now". Compute offset in minutes.
  const lastPast = manifest.past[manifest.past.length - 1];
  if (!lastPast) return timeStr;
  const offsetMin = Math.round((frame.time - lastPast.time) / 60);
  let suffix: string;
  if (offsetMin === 0) suffix = 'now';
  else if (offsetMin > 0) suffix = `+${offsetMin} min`;
  else suffix = `${offsetMin} min`;

  return `${timeStr} · ${suffix}`;
}
