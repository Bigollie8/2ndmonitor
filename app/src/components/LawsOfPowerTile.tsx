import React, { useEffect, useMemo, useState } from 'react';
import { HFTile } from './tiles';
import { LAWS, LAW_INTERVALS_H, parseLawsConfig, rotateLaw, type LawRotationState } from '../state/lawsOfPower';
import type { Density } from '../types';

const MONO = '"JetBrains Mono", ui-monospace, monospace';
/** Check cadence once a minute — rotation math decides if anything changes. */
const TICK_MS = 60 * 1000;

const lsKey = (instanceId: string) => `lawsOfPower:rotation:${instanceId}`;

function loadState(instanceId: string): LawRotationState | null {
  try {
    return JSON.parse(localStorage.getItem(lsKey(instanceId)) ?? 'null');
  } catch {
    return null;
  }
}

export interface LawsOfPowerTileProps {
  instanceId: string;
  density: Density;
  accent: string;
  editing: boolean;
  config: Record<string, unknown> | undefined;
  setConfig: (next: Record<string, unknown>) => void;
}

/** One concisely-worded law at a time, rotating on a configurable cadence.
 *  Which law shows and when it last changed persist in localStorage (keyed
 *  per instance), so reloads keep the current law instead of reshuffling;
 *  the cadence lives in tile config so it travels with export/import. */
function LawsOfPowerTileImpl({ instanceId, density, accent, editing, config, setConfig }: LawsOfPowerTileProps) {
  const { intervalHours } = useMemo(() => parseLawsConfig(config), [config]);
  const [state, setState] = useState<LawRotationState>(() =>
    rotateLaw(loadState(instanceId), Date.now(), intervalHours * 3_600_000));

  useEffect(() => {
    const tick = () => {
      setState((prev) => {
        const next = rotateLaw(prev, Date.now(), intervalHours * 3_600_000);
        if (next !== prev) localStorage.setItem(lsKey(instanceId), JSON.stringify(next));
        return next;
      });
    };
    tick(); // interval change (or mount) applies immediately
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, [instanceId, intervalHours]);

  // First mount also needs its seed persisted, or a reload before the first
  // rotation would draw a different random law.
  useEffect(() => {
    localStorage.setItem(lsKey(instanceId), JSON.stringify(state));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const law = LAWS[state.lawIndex] ?? LAWS[0];

  const headRight = editing ? (
    <select
      value={intervalHours}
      onChange={(e) => setConfig({ intervalHours: Number(e.target.value) })}
      style={{
        fontSize: 10, padding: '2px 4px', borderRadius: 4,
        background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.8)',
        border: '1px solid rgba(255,255,255,0.12)', fontFamily: MONO,
      }}
    >
      {LAW_INTERVALS_H.map((h) => (
        <option key={h} value={h}>{h === 24 ? 'daily' : `every ${h}h`}</option>
      ))}
    </select>
  ) : (
    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: MONO }}>
      {intervalHours === 24 ? 'daily' : `${intervalHours}h`}
    </span>
  );

  return (
    <HFTile title="48 Laws of Power" headRight={headRight} accent={accent} density={density} style={{ height: '100%' }}>
      <div style={{
        position: 'absolute', inset: 0, padding: '12px 14px',
        display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6,
        overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: accent, fontFamily: MONO }}>
            LAW {String(law.n).padStart(2, '0')}
          </span>
          <span style={{
            fontSize: 14, fontWeight: 700, color: '#fff', letterSpacing: '-0.01em',
            fontFamily: 'var(--font-display, inherit)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
          }}>{law.title}</span>
        </div>
        <div style={{
          fontSize: 12, lineHeight: 1.5, color: 'rgba(255,255,255,0.72)',
          display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>{law.gist}</div>
      </div>
    </HFTile>
  );
}

export const LawsOfPowerTile = React.memo(LawsOfPowerTileImpl);
