import React, { useEffect, useMemo, useState } from 'react';
import { HFTile } from './tiles';
import {
  type SolarTimes,
  type SunPhase,
  currentSunPhase,
  solarTimes,
} from '../state/solar';
import type { Density, WeatherLocation } from '../types';

const PHASE_META: Record<SunPhase, { label: string; icon: string; color: string }> = {
  night:          { label: 'Night',          icon: '🌙', color: '#6b7280' },
  dawn:           { label: 'Dawn',           icon: '🌄', color: '#a78bfa' },
  morningGolden:  { label: 'Morning golden', icon: '🌅', color: '#fbbf24' },
  day:            { label: 'Day',            icon: '☀',  color: '#fb923c' },
  eveningGolden:  { label: 'Evening golden', icon: '🌇', color: '#f59e0b' },
  dusk:           { label: 'Dusk',           icon: '🌆', color: '#a78bfa' },
};

export interface SunTileProps {
  density: Density;
  accent: string;
  location: WeatherLocation;
}

export function SunTile({ density, accent, location }: SunTileProps) {
  // Re-render every minute. Real time math comes from Date.now().
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const now = new Date();
  const times = useMemo<SolarTimes>(
    () => solarTimes(location.lat, location.lon, now),
    // Recompute when the location changes or the local date rolls over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [location.lat, location.lon, dayKey(now)],
  );
  const phase = currentSunPhase(now, times);
  const meta = PHASE_META[phase];

  const headRight = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 13, lineHeight: 1 }}>{meta.icon}</span>
      <span style={{
        fontSize: 10, color: meta.color,
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600,
      }}>{meta.label}</span>
    </div>
  );

  return (
    <HFTile title="Sun & golden hour" headRight={headRight} accent={accent} density={density}>
      <div style={{
        display: 'flex', flexDirection: 'column',
        gap: 4, padding: '4px 2px',
        width: '100%', height: '100%',
      }}>
        <Row icon="↑" label="Sunrise" time={fmtTime(times.sunrise)} accent={accent} />
        <Row icon="↓" label="Sunset"  time={fmtTime(times.sunset)}  accent={accent} />
        <Divider />
        <Row icon="🌅" label="Golden AM" time={fmtRange(times.sunrise, times.morningGoldenEnd)} subtle />
        <Row icon="🌇" label="Golden PM" time={fmtRange(times.eveningGoldenStart, times.sunset)} subtle />
        <Divider />
        <Row icon="☀" label="Solar noon" time={fmtTime(times.solarNoon)} subtle />
        <NextEventLine now={now} times={times} />
      </div>
    </HFTile>
  );
}

function Row({
  icon, label, time, accent, subtle,
}: {
  icon: string;
  label: string;
  time: string;
  accent?: string;
  subtle?: boolean;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: 6,
      fontSize: subtle ? 10 : 11, lineHeight: 1.4,
    }}>
      <span style={{
        width: 14, textAlign: 'center', flexShrink: 0,
        color: subtle ? 'rgba(255,255,255,0.4)' : (accent ?? 'rgba(255,255,255,0.6)'),
      }}>{icon}</span>
      <span style={{
        flex: 1,
        color: subtle ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.7)',
      }}>{label}</span>
      <span style={{
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        color: subtle ? 'rgba(255,255,255,0.55)' : '#fff',
      }}>{time}</span>
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '2px 0' }} />;
}

function NextEventLine({ now, times }: { now: Date; times: SolarTimes }) {
  const event = nextEvent(now, times);
  if (!event) return null;
  const minsUntil = Math.max(1, Math.round((event.at.getTime() - now.getTime()) / 60_000));
  return (
    <div style={{
      marginTop: 'auto', paddingTop: 4,
      fontSize: 10, color: 'rgba(255,255,255,0.55)',
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      textAlign: 'center',
    }}>
      Next: {event.label} in {fmtMinutes(minsUntil)}
    </div>
  );
}

function nextEvent(now: Date, times: SolarTimes): { label: string; at: Date } | null {
  const t = now.getTime();
  const candidates: { label: string; at: Date | null }[] = [
    { label: 'sunrise',         at: times.sunrise },
    { label: 'morning golden',  at: times.morningGoldenEnd },
    { label: 'evening golden',  at: times.eveningGoldenStart },
    { label: 'sunset',          at: times.sunset },
  ];
  let best: { label: string; at: Date } | null = null;
  for (const c of candidates) {
    if (!c.at) continue;
    if (c.at.getTime() <= t) continue;
    if (!best || c.at.getTime() < best.at.getTime()) {
      best = { label: c.label, at: c.at };
    }
  }
  return best;
}

function fmtTime(d: Date | null): string {
  if (!d) return '—';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function fmtRange(a: Date | null, b: Date | null): string {
  if (!a || !b) return '—';
  const sa = a.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const sb = b.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${sa} → ${sb}`;
}

function fmtMinutes(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
