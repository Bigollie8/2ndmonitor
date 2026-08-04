import React, { useEffect, useMemo, useState } from 'react';
import { HFTile } from './tiles';
import {
  type TidePredictions,
  fetchTidePredictions,
  parseNoaaTime,
  parseTidesConfig,
} from '../state/tides';
import { usePoll } from '../state/usePoll';
import { formatClock } from '../state/dateTime';
import type { Density } from '../types';
import { redactLocation } from '../state/streamer';

const REFRESH_MS = 30 * 60 * 1000; // tides are predicted, not live — half-hour refresh is plenty

export interface TidesTileProps {
  density: Density;
  accent: string;
  editing: boolean;
  config: Record<string, unknown> | undefined;
  setConfig: (next: Record<string, unknown>) => void;
  /** Streamer mode (0.7.1 §2): masks the NOAA station label/id. */
  streamer?: boolean;
  hour12: boolean;
}

function TidesTileImpl({ density, accent, editing, config, setConfig, streamer = false, hour12 }: TidesTileProps) {
  const parsed = useMemo(() => parseTidesConfig(config), [config]);
  const [now, setNow] = useState<number>(() => Date.now());

  const { data, error } = usePoll<TidePredictions | null>(
    async () => {
      if (!parsed.stationId) return null;
      const next = await fetchTidePredictions(parsed.stationId);
      if (next == null) throw new Error('fetch failed');
      // NOAA errors arrive as next.error; promote to a throw so usePoll backs
      // off and keeps the last good predictions visible.
      if (next.error) throw new Error(next.error);
      return next;
    },
    REFRESH_MS,
    [parsed.stationId],
  );

  // Tick "now" every minute so the next-tide countdown stays current.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // Find the next future tide event (relative to `now`).
  const upcoming = useMemo(() => {
    if (!data) return [];
    return data.events
      .map((e) => ({ ...e, ts: parseNoaaTime(e.t) }))
      .filter((e): e is typeof e & { ts: number } => e.ts !== null && e.ts >= now - 30 * 60 * 1000)
      .sort((a, b) => a.ts - b.ts)
      .slice(0, 4);
  }, [data, now]);

  const headRight = (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <span style={{
        fontSize: 10, color: 'rgba(255,255,255,0.55)',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      }}>{redactLocation(parsed.stationLabel || parsed.stationId || 'no station', streamer)}</span>
    </div>
  );

  return (
    <HFTile title="Tides" headRight={headRight} accent={accent} density={density} style={{ height: '100%' }}>
      <div style={{
        position: 'absolute', inset: 0, padding: 10,
        display: 'flex', flexDirection: 'column', gap: 6,
        overflow: 'hidden',
      }}>
        {!parsed.stationId && (
          <UnconfiguredPanel
            editing={editing}
            accent={accent}
            streamer={streamer}
            onSave={(stationId, stationLabel) => setConfig({ stationId, stationLabel } as unknown as Record<string, unknown>)}
          />
        )}
        {parsed.stationId && error && (
          <div style={{
            color: '#fca5a5', fontSize: 11, padding: 8,
            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
            borderRadius: 5,
          }}>
            {streamer ? 'Request failed' : error}
          </div>
        )}
        {parsed.stationId && data && !error && upcoming.length === 0 && (
          <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, padding: 8 }}>
            Loading predictions…
          </div>
        )}
        {parsed.stationId && upcoming.length > 0 && (
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
            {upcoming.map((e, i) => {
              const dtMin = Math.round((e.ts - now) / 60000);
              const isHigh = e.kind === 'H';
              const color = isHigh ? '#60a5fa' : '#facc15';
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '4px 6px',
                  fontSize: 11.5,
                }}>
                  <span style={{ color, fontWeight: 700, minWidth: 24 }}>{isHigh ? '↑ HI' : '↓ LO'}</span>
                  <span style={{
                    flex: 1, color: 'rgba(255,255,255,0.85)',
                    fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                  }}>{formatTime(e.ts, hour12)}</span>
                  <span style={{
                    color: 'rgba(255,255,255,0.7)',
                    fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                  }}>{e.v.toFixed(1)} ft</span>
                  <span style={{
                    color: 'rgba(255,255,255,0.4)', minWidth: 50, textAlign: 'right',
                    fontSize: 10, fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                  }}>{formatRelative(dtMin)}</span>
                </div>
              );
            })}
          </div>
        )}
        {parsed.stationId && editing && (
          <button
            onClick={() => setConfig({ stationId: '', stationLabel: '' } as unknown as Record<string, unknown>)}
            style={{
              padding: '4px 10px', fontSize: 10, fontWeight: 600, borderRadius: 4,
              background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.7)',
              border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer',
              alignSelf: 'flex-start', flexShrink: 0,
            }}
          >change station</button>
        )}
      </div>
    </HFTile>
  );
}

function UnconfiguredPanel({
  editing, accent, streamer, onSave,
}: { editing: boolean; accent: string; streamer: boolean; onSave: (id: string, label: string) => void }) {
  const [id, setId] = useState('');
  const [label, setLabel] = useState('');
  return (
    <div style={{
      flex: 1, minHeight: 0, padding: 10,
      display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center',
    }}>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5 }}>
        Tides need a NOAA station ID. Find one at{' '}
        <span style={{ color: accent, fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>
          tidesandcurrents.noaa.gov
        </span>
        {' '}— pick a station near a coast.
      </div>
      {editing ? (
        streamer ? (
          <>
            <input
              value={id}
              readOnly
              disabled
              placeholder="Station ID (e.g. 8443970)"
              maxLength={16}
              style={inputStyle}
            />
            <input
              value={label}
              readOnly
              disabled
              placeholder="Display name (optional)"
              maxLength={64}
              style={inputStyle}
            />
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)' }}>
              Turn off streamer mode to configure the station.
            </div>
          </>
        ) : (
          <>
            <input
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="Station ID (e.g. 8443970)"
              maxLength={16}
              style={inputStyle}
            />
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Display name (optional)"
              maxLength={64}
              style={inputStyle}
            />
            <button
              onClick={() => { if (id.trim()) onSave(id.trim(), label.trim()); }}
              disabled={!id.trim()}
              style={{
                padding: '7px 12px', fontSize: 11, fontWeight: 700,
                background: id.trim() ? accent : 'rgba(255,255,255,0.06)',
                color: id.trim() ? '#000' : 'rgba(255,255,255,0.4)',
                border: 'none', borderRadius: 5,
                cursor: id.trim() ? 'pointer' : 'not-allowed',
              }}
            >Save station</button>
          </>
        )
      ) : (
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)' }}>
          Enter edit mode to configure.
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  fontSize: 11, padding: '6px 10px', borderRadius: 4,
  background: 'rgba(255,255,255,0.04)', color: '#fff',
  border: '1px solid rgba(255,255,255,0.1)',
  fontFamily: '"JetBrains Mono", ui-monospace, monospace', outline: 'none',
};

function formatTime(ts: number, hour12: boolean): string {
  return formatClock(ts, { hour12 });
}

function formatRelative(min: number): string {
  if (min < 0) {
    const m = -min;
    if (m < 60) return `${m}m ago`;
    return `${Math.round(m / 60)}h ago`;
  }
  if (min < 60) return `in ${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `in ${h}h ${m}m` : `in ${h}h`;
}

/** Memoised (0.7.3 P2): App re-renders on any tweak change, and this tile's
 *  props are primitives or stable identities, so it can bail out. */
export const TidesTile = React.memo(TidesTileImpl);
