import React, { useEffect, useState } from 'react';
import { HFTile } from './tiles';
import { type Aircraft, fetchAircraftInBox } from '../state/opensky';
import { distanceKm } from '../state/iss';
import type { Density, WeatherLocation } from '../types';

const REFRESH_MS = 30 * 1000;
const RADIUS_KM = 80;

export interface AircraftTileProps {
  density: Density;
  accent: string;
  location: WeatherLocation;
}

export function AircraftTile({ density, accent, location }: AircraftTileProps) {
  const [planes, setPlanes] = useState<Aircraft[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const next = await fetchAircraftInBox(location.lat, location.lon, RADIUS_KM);
      if (cancelled) return;
      setPlanes(next);
      setLoading(false);
    };
    void load();
    const id = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [location.lat, location.lon]);

  const sorted = [...planes]
    .map((p) => ({ ...p, dist: distanceKm(p.lat, p.lon, location.lat, location.lon) }))
    .sort((a, b) => a.dist - b.dist);

  const headRight = (
    <span style={{
      fontSize: 10, color: 'rgba(255,255,255,0.55)',
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    }}>{loading ? '…' : `${planes.length} · ${RADIUS_KM} km`}</span>
  );

  return (
    <HFTile title="Aircraft overhead" headRight={headRight} accent={accent} density={density} style={{ height: '100%' }}>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Radar plot — circular, planes positioned by bearing+distance */}
        <div style={{
          flex: 1, minHeight: 0, position: 'relative',
          background: 'radial-gradient(circle at 50% 50%, rgba(96,165,250,0.05) 0%, rgba(8,9,12,0.85) 70%)',
        }}>
          {[0.33, 0.66, 1.0].map((r) => (
            <div key={r} style={{
              position: 'absolute', left: '50%', top: '50%',
              width: `${r * 90}%`, aspectRatio: '1 / 1',
              borderRadius: '50%',
              border: '1px solid rgba(255,255,255,0.06)',
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'none',
            }} />
          ))}
          <div style={{
            position: 'absolute', left: '50%', top: '50%',
            width: 6, height: 6, borderRadius: 999,
            background: 'rgba(255,255,255,0.6)',
            transform: 'translate(-50%, -50%)',
          }} />
          {sorted.map((p) => {
            const dx = (p.lon - location.lon) * Math.cos(location.lat * Math.PI / 180);
            const dy = (location.lat - p.lat);
            const SCALE = 50 / (RADIUS_KM / 111);
            const xPct = 50 + dx * SCALE;
            const yPct = 50 + dy * SCALE;
            return (
              <div
                key={p.icao24}
                title={`${p.callsign || p.icao24} · ${Math.round(p.dist)} km · ${Math.round(p.altitude)} m`}
                style={{
                  position: 'absolute',
                  left: `${xPct}%`, top: `${yPct}%`,
                  width: 0, height: 0, color: accent,
                  transform: `translate(-50%, -50%) rotate(${p.heading}deg)`,
                  fontSize: 14, lineHeight: 1, pointerEvents: 'none',
                }}
              >▲</div>
            );
          })}
        </div>
        {/* Closest list */}
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
          {sorted.length === 0 && !loading && (
            <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10.5, padding: 4 }}>
              No aircraft within {RADIUS_KM} km.
            </div>
          )}
        </div>
      </div>
    </HFTile>
  );
}
