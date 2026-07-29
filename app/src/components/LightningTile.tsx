import React, { useEffect, useRef, useState } from 'react';
import { HFTile } from './tiles';
import { type BlitzortungStatus, type LightningStrike, connectBlitzortung } from '../state/blitzortung';
import { distanceKm } from '../state/iss';
import { TileError } from './tileStates';
import type { Density, WeatherLocation } from '../types';

/** Strikes farther than this from the user are dropped on the floor — at
 *  global ranges the feed is firehose-rate and we'd retain too many. */
const RADIUS_KM = 800;
const MAX_STRIKES = 80;
/** A strike fades out over this duration. */
const FADE_MS = 60 * 60 * 1000;

export interface LightningTileProps {
  density: Density;
  accent: string;
  location: WeatherLocation;
}

interface RecentStrike extends LightningStrike {
  distance: number;
}

export function LightningTile({ density, accent, location }: LightningTileProps) {
  const [strikes, setStrikes] = useState<RecentStrike[]>([]);
  // Starts 'connecting': the effect below connects on mount, and starting at
  // 'disconnected' would flash the error state for one frame before it runs.
  const [status, setStatus] = useState<BlitzortungStatus>({ kind: 'connecting' });
  const [now, setNow] = useState<number>(() => Date.now());
  /** Bumped by the error-state Retry button to re-run the connect effect
   *  immediately instead of waiting out the 5s auto-reconnect. */
  const [retryTick, setRetryTick] = useState(0);
  const lastSeenRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const cleanup = connectBlitzortung({
      onStrike: (s) => {
        const distance = distanceKm(s.lat, s.lon, location.lat, location.lon);
        if (distance > RADIUS_KM) return;
        if (lastSeenRef.current.has(s.timeNs)) return;
        setStrikes((prev) => {
          const next: RecentStrike[] = [{ ...s, distance }, ...prev];
          if (next.length > MAX_STRIKES) next.length = MAX_STRIKES;
          // Rebuild the dedup set from what we kept — the feed only
          // re-delivers near-real-time duplicates, so deduping against
          // retained strikes is enough, and the set stays bounded at
          // MAX_STRIKES instead of growing for the lifetime of the tile.
          lastSeenRef.current = new Set(next.map((r) => r.timeNs));
          return next;
        });
      },
      onStatus: setStatus,
    });
    return cleanup;
  }, [location.lat, location.lon, retryTick]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  // Drop strikes older than FADE_MS (handled in render, not state, so we don't
  // dirty React on every tick — the timer above forces a re-render).
  const fresh = strikes.filter((s) => now - s.timeMs < FADE_MS);
  const closest = fresh[0];

  const headRight = (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <span style={{
        fontSize: 10, color: 'rgba(255,255,255,0.55)',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      }}>{fresh.length} strikes · {RADIUS_KM} km</span>
      <StatusDot status={status} />
    </div>
  );

  return (
    <HFTile title="Lightning · live" headRight={headRight} accent={accent} density={density} style={{ height: '100%' }}>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Spatial scatter — circular plot around user, lat/lon mapped via
         *  equirectangular within the radius. */}
        <div style={{
          flex: 1, minHeight: 0, position: 'relative',
          background: 'radial-gradient(circle at 50% 50%, rgba(250,204,21,0.04) 0%, rgba(8,9,12,0.85) 70%)',
        }}>
          {/* Range rings */}
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
          {/* Center dot (user) */}
          <div style={{
            position: 'absolute', left: '50%', top: '50%',
            width: 6, height: 6, borderRadius: 999,
            background: 'rgba(255,255,255,0.6)',
            transform: 'translate(-50%, -50%)',
          }} />
          {/* Strikes */}
          {fresh.map((s) => {
            const ageRatio = Math.min(1, (now - s.timeMs) / FADE_MS);
            const opacity = 1 - ageRatio;
            const dx = (s.lon - location.lon) * Math.cos(location.lat * Math.PI / 180);
            const dy = (location.lat - s.lat);
            // 1 deg lat ≈ 111 km — scale so RADIUS_KM == 50% (one ring radius)
            const SCALE = 50 / (RADIUS_KM / 111);
            const xPct = 50 + dx * SCALE;
            const yPct = 50 + dy * SCALE;
            return (
              <div
                key={s.timeNs}
                style={{
                  position: 'absolute',
                  left: `${xPct}%`, top: `${yPct}%`,
                  width: 6, height: 6, borderRadius: 999,
                  background: '#facc15',
                  opacity,
                  boxShadow: `0 0 ${6 * (1 - ageRatio)}px #facc15`,
                  transform: 'translate(-50%, -50%)',
                  pointerEvents: 'none',
                }}
              />
            );
          })}
          {status.kind === 'disconnected' && (
            <TileError
              line="Lightning feed disconnected."
              onRetry={() => setRetryTick((t) => t + 1)}
            />
          )}
        </div>
        {/* Closest stat row */}
        <div style={{
          padding: '6px 10px', flexShrink: 0,
          background: 'rgba(0,0,0,0.4)',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          fontSize: 10, color: 'rgba(255,255,255,0.7)',
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          display: 'flex', justifyContent: 'space-between',
        }}>
          {closest ? (
            <>
              <span>closest <span style={{ color: '#facc15' }}>{Math.round(closest.distance)} km</span></span>
              <span>{Math.round((now - closest.timeMs) / 1000)}s ago</span>
            </>
          ) : (
            <span style={{ color: 'rgba(255,255,255,0.4)' }}>no recent strikes within {RADIUS_KM} km</span>
          )}
        </div>
      </div>
    </HFTile>
  );
}

function StatusDot({ status }: { status: BlitzortungStatus }) {
  const color = status.kind === 'connected' ? '#22c55e'
    : status.kind === 'connecting' ? '#facc15' : 'rgba(255,255,255,0.3)';
  return <span style={{
    width: 7, height: 7, borderRadius: 999, background: color,
    boxShadow: status.kind === 'connected' ? `0 0 6px ${color}` : 'none',
  }} />;
}
