import React from 'react';
import { HFTile } from './tiles';
import { MapView, RecenterButton, type ProjectFn } from './map/MapView';
import { useMapView } from './map/useMapView';
import { fetchAircraftInBox } from '../state/opensky';
import { distanceKm } from '../state/iss';
import { usePoll } from '../state/usePoll';
import { redactLocation } from '../state/streamer';
import type { Density, WeatherLocation } from '../types';

const REFRESH_MS = 60 * 1000;
const RADIUS_KM = 80;
const MAP_MIN_ZOOM = 4;
const MAP_MAX_ZOOM = 12;
const MAP_DEFAULT_ZOOM = 8;
/** Callsign labels render at or above this zoom (spec: zoom ≥ 8). */
const CALLSIGN_MIN_ZOOM = 8;

export interface AircraftTileProps {
  density: Density;
  accent: string;
  location: WeatherLocation;
  config: Record<string, unknown> | undefined;
  setConfig: (next: Record<string, unknown>) => void;
  /** Streamer mode: blanks the map AND hides the nearest-5 list — callsigns
   *  + distances imply the viewer's location (0.7.1 §2). */
  redacted?: boolean;
}

export function AircraftTile({ density, accent, location, config, setConfig, redacted = false }: AircraftTileProps) {
  const { data, error, loading } = usePoll(
    async () => {
      const result = await fetchAircraftInBox(location.lat, location.lon, RADIUS_KM);
      // usePoll drives backoff off thrown errors; OpenSky rate-limit responses
      // arrive as result.error, so promote them to a throw. Last good data is
      // kept, so the radar doesn't blank out during a 429 window.
      if (result.error) throw new Error(result.error);
      return result.aircraft;
    },
    REFRESH_MS,
    [location.lat, location.lon],
  );
  const planes = data ?? [];

  const sorted = [...planes]
    .map((p) => ({ ...p, dist: distanceKm(p.lat, p.lon, location.lat, location.lon) }))
    .sort((a, b) => a.dist - b.dist);

  const { view, overridden, onViewChange, recenter } = useMapView({
    anchor: { lat: location.lat, lon: location.lon },
    defaultZoom: MAP_DEFAULT_ZOOM,
    minZoom: MAP_MIN_ZOOM,
    maxZoom: MAP_MAX_ZOOM,
    config,
    setConfig,
  });

  const drawPlanes = (ctx: CanvasRenderingContext2D, projectPt: ProjectFn) => {
    // Anchor (weather location) dot.
    const home = projectPt(location.lat, location.lon);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.arc(home.x, home.y, 3, 0, Math.PI * 2);
    ctx.fill();
    // Heading-rotated plane glyphs (dart pointing to its heading).
    for (const p of sorted) {
      const pt = projectPt(p.lat, p.lon);
      ctx.save();
      ctx.translate(pt.x, pt.y);
      ctx.rotate(p.heading * Math.PI / 180);
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4.5, 5);
      ctx.lineTo(0, 2.5);
      ctx.lineTo(-4.5, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      if (view.zoom >= CALLSIGN_MIN_ZOOM) {
        ctx.font = '9px "JetBrains Mono", ui-monospace, monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.fillText((p.callsign || p.icao24).trim().slice(0, 8), pt.x + 7, pt.y + 3);
      }
    }
  };

  const headRight = (
    <span style={{
      fontSize: 10,
      color: error ? '#fca5a5' : 'rgba(255,255,255,0.55)',
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    }} title={error ?? undefined}>
      {loading ? '…' : error ? 'OpenSky error' : `${planes.length} · ${redactLocation(`${RADIUS_KM} km`, redacted)}`}
    </span>
  );

  return (
    <HFTile title="Aircraft overhead" headRight={headRight} accent={accent} density={density} style={{ height: '100%' }}>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Real slippy map with heading-rotated glyphs */}
        <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
          <MapView
            view={view}
            onViewChange={onViewChange}
            minZoom={MAP_MIN_ZOOM}
            maxZoom={MAP_MAX_ZOOM}
            overlay={drawPlanes}
            redacted={redacted}
          />
          {overridden && <RecenterButton accent={accent} onClick={recenter} />}
        </div>
        {/* Closest list */}
        {!redacted && (
          <div style={{
            flexShrink: 0, maxHeight: '40%', overflowY: 'auto',
            padding: '4px 8px',
            borderTop: '1px solid rgba(255,255,255,0.06)',
          }}>
            {sorted.slice(0, 5).map((p) => (
              <div key={p.icao24} style={{
                display: 'flex', alignItems: 'baseline', gap: 8,
                fontSize: 10.5, padding: '2px 0',
                fontFamily: '"JetBrains Mono", ui-monospace, monospace',
              }}>
                <span style={{ color: accent, fontWeight: 700, minWidth: 56 }}>
                  {(p.callsign || p.icao24).slice(0, 8)}
                </span>
                <span style={{ flex: 1, color: 'rgba(255,255,255,0.55)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.originCountry}
                </span>
                <span style={{ color: 'rgba(255,255,255,0.7)' }}>
                  {Math.round(p.dist)} km
                </span>
                <span style={{ color: 'rgba(255,255,255,0.5)', minWidth: 50, textAlign: 'right' }}>
                  {Math.round(p.altitude)} m
                </span>
              </div>
            ))}
            {sorted.length === 0 && !loading && !error && (
              <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10.5, padding: 4 }}>
                No aircraft within {RADIUS_KM} km.
              </div>
            )}
            {error && !loading && (
              <div style={{ color: '#fca5a5', fontSize: 10.5, padding: 4, lineHeight: 1.4 }}>
                {error}
                <div style={{ color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>
                  OpenSky throttles anonymous reads — usually clears in a minute.
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </HFTile>
  );
}
