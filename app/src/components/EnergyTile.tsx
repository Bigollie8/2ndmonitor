import React, { useEffect, useMemo, useRef, useState } from 'react';
import { HFTile, Sparkline } from './tiles';
import { fetchEntityState, getStoredToken, getStoredUrl } from '../state/homeAssistant';
import { type EnergyConfig, parseEnergyConfig, parseEntityNumber } from '../state/energy';
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

export function EnergyTile({ density, accent, accent2, editing, config, setConfig }: EnergyTileProps) {
  const parsed = useMemo(() => parseEnergyConfig(config), [config]);
  const [haUrl, setHaUrl] = useState<string>(getStoredUrl);
  const [haToken, setHaToken] = useState<string>(getStoredToken);
  const [solar, setSolar] = useState<number | null>(null);
  const [grid, setGrid] = useState<number | null>(null);
  const solarHistoryRef = useRef<number[]>([]);
  const gridHistoryRef = useRef<number[]>([]);
  const [, force] = useState(0);

  // Refresh HA creds in case the user just connected via the Home Assistant
  // tile — we re-read from localStorage on focus.
  useEffect(() => {
    const onFocus = () => { setHaUrl(getStoredUrl()); setHaToken(getStoredToken()); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const haReady = !!haUrl && !!haToken;
  const configured = !!parsed.solarEntity || !!parsed.gridEntity;

  useEffect(() => {
    if (!haReady || !configured) return;
    let cancelled = false;
    const poll = async () => {
      const [solarState, gridState] = await Promise.all([
        parsed.solarEntity ? fetchEntityState(haUrl, haToken, parsed.solarEntity) : Promise.resolve(null),
        parsed.gridEntity ? fetchEntityState(haUrl, haToken, parsed.gridEntity) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      const s = parseEntityNumber(solarState?.state);
      const g = parseEntityNumber(gridState?.state);
      setSolar(s);
      setGrid(g);
      if (s != null) {
        solarHistoryRef.current = [...solarHistoryRef.current, s].slice(-HISTORY_LEN);
      }
      if (g != null) {
        gridHistoryRef.current = [...gridHistoryRef.current, g].slice(-HISTORY_LEN);
      }
      force((n) => n + 1);
    };
    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [haReady, configured, haUrl, haToken, parsed.solarEntity, parsed.gridEntity]);

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
        {!haReady && (
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
