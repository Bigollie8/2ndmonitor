import React, { useEffect, useMemo, useRef, useState } from 'react';
import { HFTile, Sparkline } from './tiles';
import { fetchEntityState, getStoredUrl } from '../state/homeAssistant';
import { getSecret } from '../state/secrets';
import { type EnergyConfig, parseEnergyConfig, parseEntityNumber } from '../state/energy';
import { usePoll } from '../state/usePoll';
import type { Density } from '../types';

const POLL_MS = 15 * 1000;
const HISTORY_LEN = 60; // ~15 minutes at 15s polling

export interface EnergyTileProps {
  density: Density;
  accent: string;
  accent2: string;
  editing: boolean;
  config: Record<string, unknown> | undefined;
  setConfig: (next: Record<string, unknown>) => void;
}

function EnergyTileImpl({ density, accent, accent2, editing, config, setConfig }: EnergyTileProps) {
  const parsed = useMemo(() => parseEnergyConfig(config), [config]);
  const [haUrl, setHaUrl] = useState<string>(getStoredUrl);
  const [haToken, setHaToken] = useState<string>('');
  const [haTokenLoaded, setHaTokenLoaded] = useState(false);
  const solarHistoryRef = useRef<number[]>([]);
  const gridHistoryRef = useRef<number[]>([]);

  // Refresh HA creds on mount and in case the user just connected via the
  // Home Assistant tile — we re-read (URL from localStorage, token from the
  // secret store) on focus.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      setHaUrl(getStoredUrl());
      getSecret('ha_token', { legacyLocalStorageKey: '2mh.ha.token' })
        .then((t) => { if (!cancelled) { setHaToken(t ?? ''); setHaTokenLoaded(true); } })
        .catch(() => { if (!cancelled) setHaTokenLoaded(true); });
    };
    load();
    window.addEventListener('focus', load);
    return () => { cancelled = true; window.removeEventListener('focus', load); };
  }, []);

  const haReady = !!haUrl && !!haToken;
  const configured = !!parsed.solarEntity || !!parsed.gridEntity;

  const { data } = usePoll(
    async () => {
      if (!haReady || !configured) return null;
      const [solarState, gridState] = await Promise.all([
        parsed.solarEntity ? fetchEntityState(haUrl, haToken, parsed.solarEntity) : Promise.resolve(null),
        parsed.gridEntity ? fetchEntityState(haUrl, haToken, parsed.gridEntity) : Promise.resolve(null),
      ]);
      const s = parseEntityNumber(solarState?.state);
      const g = parseEntityNumber(gridState?.state);
      if (s != null) {
        solarHistoryRef.current = [...solarHistoryRef.current, s].slice(-HISTORY_LEN);
      }
      if (g != null) {
        gridHistoryRef.current = [...gridHistoryRef.current, g].slice(-HISTORY_LEN);
      }
      // usePoll's own setState is the render tick that used to be `force` —
      // the fresh object each poll keeps the history refs painting.
      return { solar: s, grid: g };
    },
    POLL_MS,
    [haReady, configured, haUrl, haToken, parsed.solarEntity, parsed.gridEntity],
    'Energy',
    !haReady || !configured,
  );
  const solar = data?.solar ?? null;
  const grid = data?.grid ?? null;

  const headRight = (
    <span style={{
      fontSize: 10, color: 'rgba(255,255,255,0.55)',
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    }}>{!haReady ? 'no HA' : !configured ? 'no entities' : 'live'}</span>
  );

  return (
    <HFTile title="Energy" headRight={headRight} accent={accent} density={density} style={{ height: '100%' }}>
      <div style={{
        position: 'absolute', inset: 0, padding: 10,
        display: 'flex', flexDirection: 'column', gap: 6,
        overflow: 'hidden',
      }}>
        {haTokenLoaded && !haReady && (
          <div style={{
            color: 'rgba(255,255,255,0.55)', fontSize: 11, padding: 8,
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 5, lineHeight: 1.5,
          }}>
            Connect to Home Assistant via the Smart home tile first.
          </div>
        )}
        {haReady && !configured && (
          <ConfigPanel editing={editing} accent={accent} initial={parsed}
            onSave={(next) => setConfig(next as unknown as Record<string, unknown>)} />
        )}
        {haReady && configured && (
          <>
            {parsed.solarEntity && (
              <Pillar label="Solar" value={solar} unit="W" color={accent}
                history={solarHistoryRef.current} />
            )}
            {parsed.gridEntity && (
              <Pillar label="Grid" value={grid} unit="W" color={accent2}
                history={gridHistoryRef.current} />
            )}
          </>
        )}
        {haReady && editing && (
          <button
            onClick={() => setConfig({ solarEntity: '', gridEntity: '' } as unknown as Record<string, unknown>)}
            style={{
              padding: '4px 10px', fontSize: 10, fontWeight: 600, borderRadius: 4,
              background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.7)',
              border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer',
              alignSelf: 'flex-start', flexShrink: 0,
            }}
          >change entities</button>
        )}
      </div>
    </HFTile>
  );
}

function Pillar({
  label, value, unit, color, history,
}: { label: string; value: number | null; unit: string; color: string; history: number[] }) {
  // Normalize history to 0..1 for the Sparkline component.
  const norm = useMemo(() => {
    if (history.length < 2) return [];
    const max = Math.max(...history, 1);
    const min = Math.min(...history, 0);
    const range = Math.max(1, max - min);
    return history.map((v) => (v - min) / range);
  }, [history]);

  return (
    <div style={{
      flex: 1, minHeight: 0,
      padding: '6px 8px', borderRadius: 5,
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.06)',
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{
          fontSize: 9, color: 'rgba(255,255,255,0.45)',
          textTransform: 'uppercase', letterSpacing: '.08em',
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        }}>{label}</span>
        <span style={{
          fontSize: 18, fontWeight: 700, color,
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        }}>{value != null ? value.toFixed(0) : '—'}</span>
        <span style={{
          fontSize: 10, color: 'rgba(255,255,255,0.5)',
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        }}>{unit}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {norm.length >= 2 ? (
          <Sparkline data={norm} color={color} height="100%" />
        ) : (
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)' }}>
            collecting…
          </div>
        )}
      </div>
    </div>
  );
}

function ConfigPanel({
  editing, accent, initial, onSave,
}: {
  editing: boolean; accent: string; initial: EnergyConfig;
  onSave: (next: EnergyConfig) => void;
}) {
  const [solar, setSolar] = useState<string>(initial.solarEntity);
  const [grid, setGrid] = useState<string>(initial.gridEntity);
  return (
    <div style={{
      flex: 1, padding: 8,
      display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center',
    }}>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5 }}>
        Enter Home Assistant entity IDs for solar production and grid power
        (instantaneous watts). Either field can be left blank.
      </div>
      {editing ? (
        <>
          <input
            value={solar}
            onChange={(e) => setSolar(e.target.value.toLowerCase())}
            placeholder="sensor.solar_power"
            style={inputStyle}
          />
          <input
            value={grid}
            onChange={(e) => setGrid(e.target.value.toLowerCase())}
            placeholder="sensor.grid_power"
            style={inputStyle}
          />
          <button
            onClick={() => onSave({ solarEntity: solar.trim(), gridEntity: grid.trim() })}
            disabled={!solar.trim() && !grid.trim()}
            style={{
              padding: '7px 12px', fontSize: 11, fontWeight: 700,
              background: (solar.trim() || grid.trim()) ? accent : 'rgba(255,255,255,0.06)',
              color: (solar.trim() || grid.trim()) ? '#000' : 'rgba(255,255,255,0.4)',
              border: 'none', borderRadius: 5,
              cursor: (solar.trim() || grid.trim()) ? 'pointer' : 'not-allowed',
            }}
          >Save</button>
        </>
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

/** Memoised (0.7.3 P2): App re-renders on any tweak change, and this tile's
 *  props are primitives or stable identities, so it can bail out. */
export const EnergyTile = React.memo(EnergyTileImpl);
