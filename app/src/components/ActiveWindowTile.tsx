import React, { useEffect, useRef, useState } from 'react';
import { HFTile } from './tiles';
import {
  appDisplayName,
  fetchForeground,
  loadUsage,
  saveUsage,
} from '../state/foreground';
import { usePoll } from '../state/usePoll';
import type { Density } from '../types';

const POLL_MS = 3 * 1000;
const SAVE_MS = 30 * 1000;

interface UsageMap { [appName: string]: number }

export function ActiveWindowTile({ density, accent }: { density: Density; accent: string }) {
  const [usage, setUsage] = useState<UsageMap>(() => loadUsage().perApp);
  const lastTickRef = useRef<number>(Date.now());
  const lastPersistRef = useRef<number>(Date.now());

  const { data: current } = usePoll(
    async () => {
      const now = Date.now();
      const elapsed = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;

      const info = await fetchForeground();
      const appKey = info?.process_name ?? '';
      const title = info?.window_title ?? '';

      if (appKey && elapsed > 0 && elapsed < 30) {
        setUsage((prev) => {
          const next = { ...prev, [appKey]: (prev[appKey] ?? 0) + elapsed };
          // Persist every SAVE_MS, not every tick — localStorage writes are fast
          // but we don't need to thrash them.
          if (now - lastPersistRef.current >= SAVE_MS) {
            saveUsage({ date: new Date().toISOString().slice(0, 10), perApp: next });
            lastPersistRef.current = now;
          }
          return next;
        });
      }
      return appKey ? { app: appKey, title } : null;
    },
    POLL_MS,
    [],
  );

  // Reset bucket on date roll-over.
  useEffect(() => {
    const id = setInterval(() => {
      const today = new Date().toISOString().slice(0, 10);
      const stored = loadUsage();
      if (stored.date !== today) setUsage({});
    }, 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const totalSec = Object.values(usage).reduce((a, b) => a + b, 0);
  const sorted = Object.entries(usage)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8);

  const headRight = (
    <span style={{
      fontSize: 10, color: 'rgba(255,255,255,0.55)',
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    }}>{formatTime(totalSec)}</span>
  );

  return (
    <HFTile title="Active windows" headRight={headRight} accent={accent} density={density} style={{ height: '100%' }}>
      <div style={{
        position: 'absolute', inset: 0, padding: 10,
        display: 'flex', flexDirection: 'column', gap: 6,
        overflow: 'hidden',
      }}>
        {/* Current foreground */}
        <div style={{
          padding: '6px 8px', borderRadius: 5,
          background: `${accent}10`,
          border: `1px solid ${accent}33`,
          flexShrink: 0,
        }}>
          <div style={{
            fontSize: 9, color: 'rgba(255,255,255,0.45)',
            textTransform: 'uppercase', letterSpacing: '.06em',
            fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          }}>now</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>
              {current ? appDisplayName(current.app) : 'idle'}
            </span>
            {current?.title && (
              <span style={{
                fontSize: 10, color: 'rgba(255,255,255,0.5)', flex: 1,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{current.title}</span>
            )}
          </div>
        </div>
        {/* Today's totals */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {sorted.length === 0 && (
            <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, padding: 4 }}>
              Tracking…
            </div>
          )}
          {sorted.map(([app, sec]) => {
            const pct = totalSec > 0 ? (sec / totalSec) * 100 : 0;
            return (
              <div key={app} style={{ position: 'relative' }}>
                <div style={{
                  position: 'absolute', left: 0, top: 0, bottom: 0,
                  width: `${pct}%`,
                  background: `${accent}18`,
                  borderRadius: 3,
                  pointerEvents: 'none',
                }} />
                <div style={{
                  position: 'relative', display: 'flex', alignItems: 'baseline',
                  gap: 8, padding: '4px 6px', fontSize: 11,
                  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                }}>
                  <span style={{ flex: 1, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {appDisplayName(app)}
                  </span>
                  <span style={{ color: accent, minWidth: 50, textAlign: 'right' }}>
                    {formatTime(sec)}
                  </span>
                  <span style={{ color: 'rgba(255,255,255,0.4)', minWidth: 38, textAlign: 'right' }}>
                    {pct.toFixed(0)}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </HFTile>
  );
}

function formatTime(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
