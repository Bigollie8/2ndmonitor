import React, { useEffect, useState } from 'react';
import { HFTile } from './tiles';
import type { Density } from '../types';
import { formatClock, formatDateLine, parseDateTimeConfig, systemHour12 } from '../state/dateTime';

export interface DateTimeTileProps {
  density: Density;
  accent: string;
  config: Record<string, unknown> | undefined;
  setConfig: (next: Record<string, unknown>) => void;
}

/** Large digital clock + full date line (0.7.1 §4). Honors the system
 *  12/24-hour preference via Intl resolved options. Seconds are per-instance
 *  config; the toggle appears on hover like other tiles' inline controls. */
export function DateTimeTile({ density, accent, config, setConfig }: DateTimeTileProps) {
  const cfg = parseDateTimeConfig(config);
  const hour12 = systemHour12();
  const [now, setNow] = useState(() => Date.now());
  const [hovered, setHovered] = useState(false);

  // 1 Hz only while seconds are visible; otherwise wake once a minute,
  // aligned to the minute boundary so the displayed minute is never stale.
  useEffect(() => {
    setNow(Date.now());
    if (cfg.seconds) {
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
  }, [cfg.seconds]);

  return (
    <HFTile title="Date & time" accent={accent} density={density} style={{ height: '100%' }}>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 8,
        }}
      >
        <span
          data-testid="datetime-clock"
          style={{
            fontSize: 56, fontWeight: 700,
            fontFamily: '"JetBrains Mono", ui-monospace, monospace',
            letterSpacing: '-0.04em', lineHeight: 1, color: '#fff',
          }}
        >
          {formatClock(now, { hour12, seconds: cfg.seconds })}
        </span>
        <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>
          {formatDateLine(now)}
        </span>
        {hovered && (
          <button
            onClick={() => setConfig({ ...(config ?? {}), style: 'digital', seconds: !cfg.seconds })}
            title={cfg.seconds ? 'Hide seconds' : 'Show seconds'}
            style={{
              position: 'absolute', top: 6, right: 6,
              padding: '3px 8px', fontSize: 10, fontWeight: 600, borderRadius: 5,
              background: cfg.seconds ? `${accent}22` : 'rgba(8,9,12,0.78)',
              color: cfg.seconds ? accent : 'rgba(255,255,255,0.6)',
              border: cfg.seconds ? `1px solid ${accent}55` : '1px solid rgba(255,255,255,0.1)',
              cursor: 'pointer',
            }}
          >
            :ss
          </button>
        )}
      </div>
    </HFTile>
  );
}
