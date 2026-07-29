import React, { useState } from 'react';
import { HFTile } from './tiles';
import { appActions } from '../state/tauri';
import {
  type OnThisDayItem,
  type OnThisDayPayload,
  fetchOnThisDay,
} from '../state/onThisDay';
import { usePoll } from '../state/usePoll';
import type { Density } from '../types';

type Tab = 'events' | 'births' | 'deaths';
const TAB_LABELS: Record<Tab, string> = { events: 'Events', births: 'Births', deaths: 'Deaths' };
const TABS: Tab[] = ['events', 'births', 'deaths'];

const REFRESH_MS = 6 * 60 * 60 * 1000; // 6h — date rolls naturally during the day

export function OnThisDayTile({ density, accent }: { density: Density; accent: string }) {
  const [tab, setTab] = useState<Tab>('events');
  const { data } = usePoll<OnThisDayPayload>(
    async () => {
      const d = await fetchOnThisDay();
      if (d == null) throw new Error('fetch failed');
      return d;
    },
    REFRESH_MS,
  );

  const items: OnThisDayItem[] = data ? data[tab] : [];
  const headRight = (
    <span style={{
      fontSize: 10, color: 'rgba(255,255,255,0.45)',
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    }}>{new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}</span>
  );

  return (
    <HFTile title="On this day" headRight={headRight} accent={accent} density={density} style={{ height: '100%' }}>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)',
          flexShrink: 0,
        }}>
          {TABS.map((t) => {
            const active = t === tab;
            return (
              <button key={t} onClick={() => setTab(t)} style={{
                flex: 1, padding: '6px 0',
                background: active ? `${accent}10` : 'transparent',
                border: 'none',
                borderBottom: active ? `2px solid ${accent}` : '2px solid transparent',
                color: active ? accent : 'rgba(255,255,255,0.55)',
                fontSize: 10, fontWeight: 600, letterSpacing: '.06em',
                textTransform: 'uppercase',
                fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                cursor: 'pointer',
              }}>{TAB_LABELS[t]}</button>
            );
          })}
        </div>
        <div style={{
          flex: 1, minHeight: 0, overflowY: 'auto',
          padding: '6px 10px',
        }}>
          {!data && (
            <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, padding: 8 }}>
              Loading…
            </div>
          )}
          {data && items.length === 0 && (
            <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, padding: 8 }}>
              No items today.
            </div>
          )}
          {items.map((it, i) => (
            <div
              key={i}
              onClick={() => { if (it.url) void appActions.openUrl(it.url); }}
              style={{
                padding: '5px 6px', fontSize: 11.5, lineHeight: 1.45,
                cursor: it.url ? 'pointer' : 'default',
                borderRadius: 4,
                color: 'rgba(255,255,255,0.85)',
              }}
            >
              <span style={{
                fontWeight: 700, color: accent,
                fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                marginRight: 8,
              }}>{formatYear(it.year)}</span>
              {it.text}
            </div>
          ))}
        </div>
      </div>
    </HFTile>
  );
}

function formatYear(year: number): string {
  if (year < 0) return `${-year} BC`;
  return year.toString();
}
