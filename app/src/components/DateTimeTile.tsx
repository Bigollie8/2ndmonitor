import React, { useEffect, useRef, useState } from 'react';
import { HFTile } from './tiles';
import type { Density } from '../types';
import {
  DATE_TIME_STYLES,
  type DateTimeStyle,
  formatClock,
  formatDateLine,
  handAngles,
  parseDateTimeConfig,
} from '../state/dateTime';

export interface DateTimeTileProps {
  density: Density;
  accent: string;
  config: Record<string, unknown> | undefined;
  setConfig: (next: Record<string, unknown>) => void;
  /** Resolved platform clock format — overrides systemHour12 when the tweak
   *  isn't 'system'. */
  hour12: boolean;
}

/** Clock tile with three styles (0.7.2 §4): digital (0.7.1 rendering),
 *  minimal (time only, larger), analog (canvas face). Style + seconds are
 *  per-instance config; hover controls cycle style / toggle seconds. */
export function DateTimeTile({ density, accent, config, setConfig, hour12 }: DateTimeTileProps) {
  const cfg = parseDateTimeConfig(config);
  // 'minimal' never shows seconds — the toggle is hidden there and the
  // cadence drops to once a minute.
  const showSeconds = cfg.seconds && cfg.style !== 'minimal';
  const [now, setNow] = useState(() => Date.now());
  const [hovered, setHovered] = useState(false);

  // 1 Hz only while seconds are visible; otherwise wake once a minute,
  // aligned to the minute boundary so the displayed minute is never stale.
  useEffect(() => {
    setNow(Date.now());
    if (showSeconds) {
      const id = setInterval(() => setNow(Date.now()), 1000);
      return () => clearInterval(id);
    }
    let interval: ReturnType<typeof setInterval> | null = null;
    const timeout = setTimeout(() => {
      setNow(Date.now());
      interval = setInterval(() => setNow(Date.now()), 60_000);
    }, 60_000 - (Date.now() % 60_000));
    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, [showSeconds]);

  const nextStyle: DateTimeStyle =
    DATE_TIME_STYLES[(DATE_TIME_STYLES.indexOf(cfg.style) + 1) % DATE_TIME_STYLES.length]!;

  const hoverBtn = (active: boolean): React.CSSProperties => ({
    padding: '3px 8px', fontSize: 10, fontWeight: 600, borderRadius: 5,
    background: active ? `${accent}22` : 'rgba(8,9,12,0.78)',
    color: active ? accent : 'rgba(255,255,255,0.6)',
    border: active ? `1px solid ${accent}55` : '1px solid rgba(255,255,255,0.1)',
    cursor: 'pointer',
  });

  return (
    <HFTile title="Date & time" accent={accent} density={density} style={{ height: '100%' }}>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: cfg.style === 'analog' ? '10px 10px 12px' : 0,
        }}
      >
        {cfg.style === 'analog' ? (
          <>
            <div style={{ flex: 1, alignSelf: 'stretch', minHeight: 0 }}>
              <AnalogClock now={now} accent={accent} seconds={showSeconds} />
            </div>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>
              {formatDateLine(now)}
            </span>
          </>
        ) : (
          <>
            <span
              data-testid="datetime-clock"
              style={{
                fontSize: cfg.style === 'minimal' ? 76 : 56, fontWeight: 700,
                fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                letterSpacing: '-0.04em', lineHeight: 1, color: '#fff',
              }}
            >
              {formatClock(now, { hour12, seconds: showSeconds })}
            </span>
            {cfg.style === 'digital' && (
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>
                {formatDateLine(now)}
              </span>
            )}
          </>
        )}
        {hovered && (
          <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 4 }}>
            <button
              data-testid="datetime-style-cycle"
              onClick={() => setConfig({ ...(config ?? {}), style: nextStyle, seconds: cfg.seconds })}
              title={`Style: ${cfg.style} — click for ${nextStyle}`}
              style={hoverBtn(false)}
            >
              {cfg.style}
            </button>
            {cfg.style !== 'minimal' && (
              <button
                onClick={() => setConfig({ ...(config ?? {}), style: cfg.style, seconds: !cfg.seconds })}
                title={cfg.seconds ? 'Hide seconds' : 'Show seconds'}
                style={hoverBtn(cfg.seconds)}
              >
                :ss
              </button>
            )}
          </div>
        )}
      </div>
    </HFTile>
  );
}

/** Canvas clock face. No opaque fill — the themed tile surface
 *  (var(--surface-tile), glass included) shows through; ring and hands are
 *  translucent white, the second hand and hub use the accent. */
function AnalogClock({ now, accent, seconds }: { now: number; accent: string; seconds: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  // Bumped by ResizeObserver so the draw effect below re-runs when the tile
  // is resized (drag-resize, orientation switch), not just on tick/prop change.
  const [resizeTick, setResizeTick] = useState(0);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => setResizeTick((t) => t + 1));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const r = Math.min(cx, cy) - 4;
    if (r <= 8) return;
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 12; i++) {
      const a = (i * 30) * Math.PI / 180;
      ctx.beginPath();
      ctx.moveTo(cx + Math.sin(a) * (r - 8), cy - Math.cos(a) * (r - 8));
      ctx.lineTo(cx + Math.sin(a) * (r - 2), cy - Math.cos(a) * (r - 2));
      ctx.stroke();
    }
    const angles = handAngles(now);
    const hand = (deg: number, len: number, width: number, color: string) => {
      const a = deg * Math.PI / 180;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.sin(a) * len, cy - Math.cos(a) * len);
      ctx.stroke();
    };
    hand(angles.hour, r * 0.5, 4, '#fff');
    hand(angles.minute, r * 0.75, 2.5, 'rgba(255,255,255,0.85)');
    if (seconds) hand(angles.second, r * 0.85, 1, accent);
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();
  }, [now, accent, seconds, resizeTick]);
  return <canvas ref={ref} data-testid="datetime-analog" style={{ width: '100%', height: '100%', display: 'block' }} />;
}
