import React, { useEffect, useRef } from 'react';
import { HFTile } from './tiles';
import { MapView, RecenterButton, type ProjectFn } from './map/MapView';
import { drawHomeDot } from './map/homeDot';
import { useMapView } from './map/useMapView';
import { distanceKm, fetchIssPosition } from '../state/iss';
import { usePoll } from '../state/usePoll';
import { redactLocation } from '../state/streamer';
import type { Density, WeatherLocation } from '../types';

const REFRESH_MS = 15 * 1000;
const MAP_MIN_ZOOM = 1;
const MAP_MAX_ZOOM = 6;
const MAP_DEFAULT_ZOOM = 2;
/** Ground-track points kept (spec: trail grows from positions accumulated
 *  while polling — no orbit propagation). 240 × 15s ≈ the last hour. */
const TRAIL_MAX = 240;

export interface IssTileProps {
  density: Density;
  accent: string;
  location: WeatherLocation;
  config: Record<string, unknown> | undefined;
  setConfig: (next: Record<string, unknown>) => void;
  /** Streamer mode (0.7.1 §2): blanks the map — see MapView.redacted. */
  redacted?: boolean;
}

export function IssTile({ density, accent, location, config, setConfig, redacted = false }: IssTileProps) {
  const { data: pos } = usePoll(
    async () => {
      // fetchIssPosition returns null on failure; usePoll drives backoff off
      // thrown errors, so promote the null to a throw. Last good position is
      // kept, matching the old only-set-when-truthy behavior.
      const p = await fetchIssPosition();
      if (p == null) throw new Error('fetch failed');
      return p;
    },
    REFRESH_MS,
    [],
  );

  // Ground track accumulated while the tile runs. A ref, not state — the tile
  // re-renders on every poll anyway, and the overlay reads it at draw time.
  const trailRef = useRef<Array<{ lat: number; lon: number }>>([]);
  useEffect(() => {
    if (!pos) return;
    const trail = trailRef.current;
    const last = trail[trail.length - 1];
    if (last && last.lat === pos.lat && last.lon === pos.lon) return;
    trail.push({ lat: pos.lat, lon: pos.lon });
    if (trail.length > TRAIL_MAX) trail.shift();
  }, [pos]);

  const distance = pos ? distanceKm(pos.lat, pos.lon, location.lat, location.lon) : null;
  const inEclipse = pos?.visibility === 'eclipsed';

  // Anchor is the live ISS position — with no user override the view follows
  // the station across the world map.
  const { view, overridden, onViewChange, recenter } = useMapView({
    anchor: pos ? { lat: pos.lat, lon: pos.lon } : { lat: 0, lon: 0 },
    defaultZoom: MAP_DEFAULT_ZOOM,
    minZoom: MAP_MIN_ZOOM,
    maxZoom: MAP_MAX_ZOOM,
    config,
    setConfig,
  });

  const drawIss = (ctx: CanvasRenderingContext2D, projectPt: ProjectFn) => {
    // Trail, oldest → newest, alpha ramping toward the head. Segments that
    // jump the antimeridian are skipped (project takes the short way around,
    // so a >180° lon jump would draw a line across the whole map).
    const trail = trailRef.current;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = accent;
    for (let i = 1; i < trail.length; i++) {
      const a = trail[i - 1];
      const b = trail[i];
      if (Math.abs(b.lon - a.lon) > 180) continue;
      const pa = projectPt(a.lat, a.lon);
      const pb = projectPt(b.lat, b.lon);
      ctx.globalAlpha = 0.15 + 0.6 * (i / trail.length);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // User pin.
    drawHomeDot(ctx, projectPt, location.lat, location.lon);
    // ISS glyph at the current position.
    if (pos) {
      const pt = projectPt(pos.lat, pos.lon);
      ctx.shadowColor = accent;
      ctx.shadowBlur = 10;
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  };

  const headRight = (
    <span style={{
      fontSize: 10, color: 'rgba(255,255,255,0.55)',
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    }}>{pos ? (inEclipse ? '🌑 eclipsed' : '☀ daylight') : '—'}</span>
  );

  return (
    <HFTile title="ISS · live" headRight={headRight} accent={accent} density={density} style={{ height: '100%' }}>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* World map with the accumulated ground track */}
        <div style={{
          flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
        }}>
          <MapView
            view={view}
            onViewChange={onViewChange}
            minZoom={MAP_MIN_ZOOM}
            maxZoom={MAP_MAX_ZOOM}
            overlay={drawIss}
            redacted={redacted}
          />
          {overridden && <RecenterButton accent={accent} onClick={recenter} />}
        </div>
        {/* Stats row */}
        <div style={{
          display: 'flex', padding: '6px 10px', gap: 8,
          fontSize: 10, color: 'rgba(255,255,255,0.7)',
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          flexShrink: 0, justifyContent: 'space-between',
        }}>
          {pos ? (
            <>
              <span><span style={{ color: 'rgba(255,255,255,0.4)' }}>lat </span>{pos.lat.toFixed(2)}°</span>
              <span><span style={{ color: 'rgba(255,255,255,0.4)' }}>lon </span>{pos.lon.toFixed(2)}°</span>
              <span><span style={{ color: 'rgba(255,255,255,0.4)' }}>v </span>{Math.round(pos.velocity)} km/h</span>
              <span><span style={{ color: 'rgba(255,255,255,0.4)' }}>alt </span>{pos.altitude.toFixed(0)} km</span>
              {distance != null && (
                <span><span style={{ color: 'rgba(255,255,255,0.4)' }}>Δ </span>{redactLocation(`${Math.round(distance)} km`, redacted)}</span>
              )}
            </>
          ) : (
            <span style={{ color: 'rgba(255,255,255,0.45)' }}>fetching…</span>
          )}
        </div>
      </div>
    </HFTile>
  );
}
