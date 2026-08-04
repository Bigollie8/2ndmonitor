import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HFTile } from './tiles';
import { MapView, RecenterButton, type ProjectFn } from './map/MapView';
import { drawHomeDot } from './map/homeDot';
import { useMapView } from './map/useMapView';
import { type BlitzortungStatus, type LightningStrike, connectBlitzortung } from '../state/blitzortung';
import { distanceKm } from '../state/iss';
import { redactLocation } from '../state/streamer';
import { TileError } from './tileStates';
import type { Density, WeatherLocation } from '../types';

/** Strikes farther than this from the user are dropped on the floor — at
 *  global ranges the feed is firehose-rate and we'd retain too many. */
const RADIUS_KM = 800;
const MAX_STRIKES = 80;
/** A strike fades out over this duration. */
const FADE_MS = 60 * 60 * 1000;
const MAP_MIN_ZOOM = 3;
const MAP_MAX_ZOOM = 10;
const MAP_DEFAULT_ZOOM = 5;

export interface LightningTileProps {
  density: Density;
  accent: string;
  location: WeatherLocation;
  config: Record<string, unknown> | undefined;
  setConfig: (next: Record<string, unknown>) => void;
  /** Streamer mode (0.7.1 §2): blanks the map — see MapView.redacted. */
  redacted?: boolean;
}

interface RecentStrike extends LightningStrike {
  distance: number;
}

function LightningTileImpl({ density, accent, location, config, setConfig, redacted = false }: LightningTileProps) {
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
  // Memoised so drawStrikes' identity is stable between renders (0.7.3 P5).
  const fresh = useMemo(() => strikes.filter((s) => now - s.timeMs < FADE_MS), [strikes, now]);
  const closest = fresh[0];

  const { view, overridden, onViewChange, recenter } = useMapView({
    anchor: { lat: location.lat, lon: location.lon },
    defaultZoom: MAP_DEFAULT_ZOOM,
    minZoom: MAP_MIN_ZOOM,
    maxZoom: MAP_MAX_ZOOM,
    config,
    setConfig,
  });

  const drawStrikes = useCallback((ctx: CanvasRenderingContext2D, projectPt: ProjectFn) => {
    // Center dot (user).
    drawHomeDot(ctx, projectPt, location.lat, location.lon);
    // Strikes: yellow dots fading (and losing glow) with age.
    for (const s of fresh) {
      const ageRatio = Math.min(1, (now - s.timeMs) / FADE_MS);
      const pt = projectPt(s.lat, s.lon);
      ctx.globalAlpha = 1 - ageRatio;
      ctx.shadowColor = '#facc15';
      ctx.shadowBlur = 6 * (1 - ageRatio);
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }, [fresh, now, location.lat, location.lon]);

  const headRight = (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <span style={{
        fontSize: 10, color: 'rgba(255,255,255,0.55)',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      }}>{fresh.length} strikes · {redactLocation(`${RADIUS_KM} km`, redacted)}</span>
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
        {/* Real slippy map with age-faded strike dots */}
        <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
          <MapView
            view={view}
            onViewChange={onViewChange}
            minZoom={MAP_MIN_ZOOM}
            maxZoom={MAP_MAX_ZOOM}
            overlay={drawStrikes}
            redacted={redacted}
          />
          {overridden && <RecenterButton accent={accent} onClick={recenter} />}
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
              <span>closest <span style={{ color: '#facc15' }}>{redactLocation(`${Math.round(closest.distance)} km`, redacted)}</span></span>
              <span>{Math.round((now - closest.timeMs) / 1000)}s ago</span>
            </>
          ) : (
            <span style={{ color: 'rgba(255,255,255,0.4)' }}>no recent strikes within {redactLocation(`${RADIUS_KM} km`, redacted)}</span>
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

/** Memoised (0.7.3 P2): App re-renders on any tweak change, and this tile's
 *  props are primitives or stable identities, so it can bail out. */
export const LightningTile = React.memo(LightningTileImpl);
