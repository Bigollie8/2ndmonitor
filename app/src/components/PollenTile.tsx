import React, { useEffect, useState } from 'react';
import { HFTile } from './tiles';
import {
  type PollenSample,
  fetchPollenSample,
  pollenLevel,
  smokeLevel,
} from '../state/pollen';
import type { Density, WeatherLocation } from '../types';

const REFRESH_MS = 30 * 60 * 1000;

export interface PollenTileProps {
  density: Density;
  accent: string;
  location: WeatherLocation;
}

export function PollenTile({ density, accent, location }: PollenTileProps) {
  const [sample, setSample] = useState<PollenSample | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const s = await fetchPollenSample(location.lat, location.lon);
      if (!cancelled && s) setSample(s);
    };
    void load();
    const id = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [location.lat, location.lon]);

  const headRight = (
    <span style={{
      fontSize: 10, color: 'rgba(255,255,255,0.55)',
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    }}>{location.label}</span>
  );

  const smoke = smokeLevel(sample?.pm25 ?? null);

  return (
    <HFTile title="Pollen & smoke" headRight={headRight} accent={accent} density={density} style={{ height: '100%' }}>
      <div style={{
        position: 'absolute', inset: 0, padding: 12,
        display: 'flex', flexDirection: 'column', gap: 6,
        overflow: 'hidden',
      }}>
        {!sample && (
          <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11 }}>Loading…</div>
        )}
        {sample && (
          <>
            {/* Smoke indicator gets prominence — wildfire is the more urgent signal */}
            <div style={{
              padding: '8px 10px', borderRadius: 5,
              background: `${smoke.color}10`,
              border: `1px solid ${smoke.color}55`,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <span style={{ fontSize: 22 }}>🔥</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 9, color: 'rgba(255,255,255,0.45)',
                  textTransform: 'uppercase', letterSpacing: '.08em',
                  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                }}>Wildfire smoke</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{
                    fontSize: 18, fontWeight: 700, color: smoke.color,
                    fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                  }}>
                    {sample.pm25 != null ? sample.pm25.toFixed(1) : '—'}
                  </span>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>µg/m³ PM2.5</span>
                  <span style={{ fontSize: 10, color: smoke.color, fontWeight: 600, marginLeft: 'auto' }}>
                    {smoke.label}
                  </span>
                </div>
              </div>
            </div>

            {/* Pollen grid */}
            <div style={{
              flex: 1, minHeight: 0, overflowY: 'auto',
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4,
            }}>
              <PollenCell label="Grass"    value={sample.grass}   />
              <PollenCell label="Birch"    value={sample.birch}   />
              <PollenCell label="Ragweed"  value={sample.ragweed} />
              <PollenCell label="Olive"    value={sample.olive}   />
              <PollenCell label="Alder"    value={sample.alder}   />
              <PollenCell label="Mugwort"  value={sample.mugwort} />
            </div>
          </>
        )}
      </div>
    </HFTile>
  );
}

function PollenCell({ label, value }: { label: string; value: number | null }) {
  const lvl = pollenLevel(value);
  return (
    <div style={{
      padding: '5px 8px', borderRadius: 4,
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.06)',
      display: 'flex', flexDirection: 'column', gap: 1,
    }}>
      <div style={{
        fontSize: 9, color: 'rgba(255,255,255,0.5)',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        textTransform: 'uppercase', letterSpacing: '.05em',
      }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{
          fontSize: 13, fontWeight: 700, color: lvl.color,
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        }}>{value != null ? value.toFixed(0) : '—'}</span>
        <span style={{ fontSize: 9, color: lvl.color, opacity: 0.85 }}>{lvl.label}</span>
      </div>
    </div>
  );
}
