import React, { useEffect, useState } from 'react';
import { HFTile } from './tiles';
import { type SpaceLaunch, fetchUpcomingLaunches } from '../state/launches';
import type { Density } from '../types';

const REFRESH_MS = 30 * 60 * 1000; // 30m — anon rate limit on Launch Library is 15/h

export function LaunchesTile({ density, accent }: { density: Density; accent: string }) {
  const [launches, setLaunches] = useState<SpaceLaunch[]>([]);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const next = await fetchUpcomingLaunches(8);
      if (!cancelled) setLaunches(next);
    };
    void load();
    const id = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const headRight = (
    <span style={{
      fontSize: 10, color: 'rgba(255,255,255,0.45)',
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    }}>{launches.length} upcoming</span>
  );

  return (
    <HFTile title="Space launches" headRight={headRight} accent={accent} density={density} style={{ height: '100%' }}>
      <div style={{
        position: 'absolute', inset: 0, padding: '6px 8px',
        overflowY: 'auto',
      }}>
        {launches.length === 0 && (
          <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, padding: 8 }}>
            Loading…
          </div>
        )}
        {launches.map((l) => (
          <LaunchRow key={l.id} launch={l} now={now} accent={accent} />
        ))}
      </div>
    </HFTile>
  );
}

function LaunchRow({ launch, now, accent }: { launch: SpaceLaunch; now: number; accent: string }) {
  const ts = launch.net ? Date.parse(launch.net) : null;
  const dtMin = ts ? Math.round((ts - now) / 60000) : null;
  const statusColor = launch.status.abbrev === 'Go'
    ? '#22c55e' : launch.status.abbrev === 'TBD'
    ? 'rgba(255,255,255,0.4)' : launch.status.abbrev === 'Hold' || launch.status.abbrev === 'Failure'
    ? '#ef4444' : 'rgba(255,255,255,0.6)';
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 2,
      padding: '6px 8px', marginBottom: 3,
      borderRadius: 4,
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.05)',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: '#fff', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {launch.name}
        </span>
        <span style={{
          fontSize: 9, color: statusColor, padding: '1px 5px',
          background: `${statusColor}15`, borderRadius: 3,
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          flexShrink: 0,
        }}>{launch.status.abbrev || launch.status.name}</span>
      </div>
      <div style={{
        fontSize: 10, color: 'rgba(255,255,255,0.55)',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        display: 'flex', gap: 6, flexWrap: 'wrap',
      }}>
        <span>{launch.provider}</span>
        {launch.rocket && <span style={{ color: 'rgba(255,255,255,0.35)' }}>· {launch.rocket}</span>}
        {dtMin != null && (
          <span style={{ marginLeft: 'auto', color: accent, fontWeight: 600 }}>
            {formatRelative(dtMin)}
          </span>
        )}
      </div>
      {launch.mission && (
        <div style={{
          fontSize: 10, color: 'rgba(255,255,255,0.45)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{launch.mission}</div>
      )}
    </div>
  );
}

function formatRelative(min: number): string {
  if (min < 0) return `T+${formatHM(-min)}`;
  return `T-${formatHM(min)}`;
}
function formatHM(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}h${min % 60 ? ` ${min % 60}m` : ''}`;
  const d = Math.floor(h / 24);
  return `${d}d${h % 24 ? ` ${h % 24}h` : ''}`;
}
