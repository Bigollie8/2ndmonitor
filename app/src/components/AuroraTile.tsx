import React, { useEffect, useMemo, useState } from 'react';
import { HFTile } from './tiles';
import {
  type AuroraVisibility,
  auroraVisibility,
  fetchKpForecast,
  fetchKpRecent,
  moonPhase,
  moonPhaseEmoji,
} from '../state/aurora';
import { usePoll } from '../state/usePoll';
import type { Density, WeatherLocation } from '../types';

const KP_REFRESH_MS = 10 * 60 * 1000;
const TICK_MS = 60 * 1000;

const KP_COLOR = (kp: number): string => {
  if (kp >= 7) return '#ef4444'; // red — severe
  if (kp >= 5) return '#f97316'; // orange — storm (G1+)
  if (kp >= 4) return '#fbbf24'; // yellow — active
  return '#22d3ee';              // teal — quiet
};

const VIS_LABEL: Record<AuroraVisibility, string> = {
  unlikely: 'Not visible',
  horizon: 'Northern horizon',
  overhead: 'Overhead',
};

const VIS_COLOR: Record<AuroraVisibility, string> = {
  unlikely: 'rgba(255,255,255,0.45)',
  horizon: '#22d3ee',
  overhead: '#a78bfa',
};

export interface AuroraTileProps {
  density: Density;
  accent: string;
  location: WeatherLocation;
  hour12: boolean;
}

export function AuroraTile({ density, accent, location, hour12 }: AuroraTileProps) {
  const [, setTick] = useState(0);

  // Fetch KP on mount + every 10 minutes. Both fetchers return [] on failure
  // (indistinguishable from a legitimately empty response), so nothing to
  // promote to a throw here.
  const { data } = usePoll(
    async () => {
      const [r, f] = await Promise.all([fetchKpRecent(), fetchKpForecast()]);
      return { recent: r, forecast: f };
    },
    KP_REFRESH_MS,
    [],
  );
  const recent = data?.recent ?? [];
  const forecast = data?.forecast ?? [];

  // Re-render every minute (for moon phase + relative time labels)
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const currentKp = recent.length > 0 ? recent[recent.length - 1]!.kp : null;
  const forecastBars = forecast.slice(0, 8); // next ~24 hours (8 × 3h)
  const visibility = currentKp !== null ? auroraVisibility(currentKp, location.lat) : 'unlikely';

  const now = new Date();
  const moon = useMemo(() => moonPhase(now), [Math.floor(now.getTime() / (60 * 60 * 1000))]);

  const headRight = (
    <span style={{
      fontSize: 10, color: 'rgba(255,255,255,0.55)',
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    }}>{location.label}</span>
  );

  return (
    <HFTile title="Aurora & moon" headRight={headRight} accent={accent} density={density} style={{ height: '100%' }}>
      <div style={{
        display: 'flex', flexDirection: 'column',
        width: '100%', height: '100%', gap: 6,
      }}>
        {/* Current KP + visibility */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{
            fontSize: 'clamp(20px, 14%, 36px)', fontWeight: 700,
            fontFamily: '"JetBrains Mono", ui-monospace, monospace',
            color: currentKp !== null ? KP_COLOR(currentKp) : 'rgba(255,255,255,0.4)',
            lineHeight: 1,
          }}>
            {currentKp !== null ? `Kp ${currentKp.toFixed(1)}` : 'Kp —'}
          </span>
        </div>
        <span style={{
          fontSize: 10, fontWeight: 600,
          color: VIS_COLOR[visibility],
          textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          {VIS_LABEL[visibility]}
        </span>

        {/* Forecast bars */}
        {forecastBars.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{
              fontSize: 9, color: 'rgba(255,255,255,0.4)',
              textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600,
            }}>Next 24h</span>
            <div style={{
              display: 'flex', alignItems: 'flex-end', gap: 2,
              height: 22,
            }}>
              {forecastBars.map((entry) => (
                <div
                  key={entry.time}
                  title={`Kp ${entry.kp.toFixed(1)} at ${new Date(entry.time * 1000).toLocaleTimeString([], { hour: 'numeric', hour12 })}`}
                  style={{
                    flex: 1,
                    height: `${Math.max(8, (entry.kp / 9) * 100)}%`,
                    background: KP_COLOR(entry.kp),
                    borderRadius: 1,
                    opacity: 0.85,
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Moon phase */}
        <div style={{
          marginTop: 'auto', paddingTop: 6,
          display: 'flex', alignItems: 'center', gap: 8,
          borderTop: '1px solid rgba(255,255,255,0.06)',
        }}>
          <span style={{ fontSize: 18, lineHeight: 1 }}>{moonPhaseEmoji(moon.phase)}</span>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
            <span style={{
              fontSize: 10, fontWeight: 600,
              color: 'rgba(255,255,255,0.75)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{moon.name}</span>
            <span style={{
              fontSize: 9,
              color: 'rgba(255,255,255,0.45)',
              fontFamily: '"JetBrains Mono", ui-monospace, monospace',
            }}>{Math.round(moon.illumination * 100)}% lit</span>
          </div>
        </div>
      </div>
    </HFTile>
  );
}
