import React, { useEffect, useState } from 'react';
import { HFTile } from './tiles';
import { type IssPosition, distanceKm, fetchIssPosition } from '../state/iss';
import type { Density, WeatherLocation } from '../types';

const REFRESH_MS = 5 * 1000;

export interface IssTileProps {
  density: Density;
  accent: string;
  location: WeatherLocation;
}

export function IssTile({ density, accent, location }: IssTileProps) {
  const [pos, setPos] = useState<IssPosition | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const p = await fetchIssPosition();
      if (!cancelled && p) setPos(p);
    };
    void load();
    const id = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const distance = pos ? distanceKm(pos.lat, pos.lon, location.lat, location.lon) : null;
  const inEclipse = pos?.visibility === 'eclipsed';

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
        {/* Equirectangular projection: lon -180..180 → 0..100% x, lat -90..90 → 0..100% y (inverted) */}
        <div style={{
          flex: 1, minHeight: 0, position: 'relative',
          background: 'radial-gradient(ellipse at 30% 30%, rgba(96,165,250,0.10) 0%, rgba(8,9,12,0.8) 60%)',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
        }}>
          {/* Equator + prime meridian guides */}
          <div style={{
            position: 'absolute', left: 0, right: 0, top: '50%',
            height: 1, background: 'rgba(255,255,255,0.06)',
          }} />
          <div style={{
            position: 'absolute', top: 0, bottom: 0, left: '50%',
            width: 1, background: 'rgba(255,255,255,0.06)',
          }} />
          {/* User pin */}
          <div style={{
            position: 'absolute',
            left: `${(location.lon + 180) / 360 * 100}%`,
            top: `${(90 - location.lat) / 180 * 100}%`,
            width: 8, height: 8, borderRadius: 999,
            background: 'rgba(255,255,255,0.7)',
            transform: 'translate(-50%, -50%)',
            boxShadow: '0 0 6px rgba(255,255,255,0.6)',
          }} title={location.label} />
          {/* ISS pin */}
          {pos && (
            <div style={{
              position: 'absolute',
              left: `${(pos.lon + 180) / 360 * 100}%`,
              top: `${(90 - pos.lat) / 180 * 100}%`,
              width: 12, height: 12, borderRadius: 999,
              background: accent,
              transform: 'translate(-50%, -50%)',
              boxShadow: `0 0 12px ${accent}, 0 0 4px ${accent}`,
              transition: 'left 0.5s linear, top 0.5s linear',
            }}>
              <div style={{
                position: 'absolute', inset: -6,
                borderRadius: 999, border: `2px solid ${accent}55`,
                animation: 'iss-pulse 2s ease-out infinite',
              }} />
            </div>
          )}
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
                <span><span style={{ color: 'rgba(255,255,255,0.4)' }}>Δ </span>{Math.round(distance)} km</span>
              )}
            </>
          ) : (
            <span style={{ color: 'rgba(255,255,255,0.45)' }}>fetching…</span>
          )}
        </div>
      </div>
      <style>{`@keyframes iss-pulse { 0% { transform: scale(1); opacity: 1; } 100% { transform: scale(2.4); opacity: 0; } }`}</style>
    </HFTile>
  );
}
