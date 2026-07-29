import React, { useState } from 'react';
import { HFTile } from './tiles';
import {
  type BirdObservation,
  fetchRecentBirds,
  getStoredRadius,
  setStoredRadius,
} from '../state/ebird';
import { useSecret } from '../state/secrets';
import { usePoll } from '../state/usePoll';
import { TileEmpty, TileError, TileNeedsSetup, TileSkeleton } from './tileStates';
import type { Density, WeatherLocation } from '../types';

const REFRESH_MS = 15 * 60 * 1000;

export interface BirdsTileProps {
  density: Density;
  accent: string;
  editing: boolean;
  location: WeatherLocation;
}

export function BirdsTile({ density, accent, editing, location }: BirdsTileProps) {
  const { value: token, loaded, save: saveToken, clear: clearToken } =
    useSecret('ebird_key', { legacyLocalStorageKey: '2mh.ebird.token' });
  const [radius, setRadius] = useState<number>(getStoredRadius);
  const [setupOpen, setSetupOpen] = useState(false);
  const { data, error, loading, refresh } = usePoll<BirdObservation[]>(
    async () => {
      /* No key yet: nothing to fetch — the connect panel is showing. Saving a
       * key changes `token`, which is in the deps, so the first real fetch
       * fires immediately. */
      if (!token) return [];
      return fetchRecentBirds(token, location.lat, location.lon, radius);
    },
    REFRESH_MS,
    [token, radius, location.lat, location.lon],
  );
  const obs = data ?? [];

  const headRight = (
    <span style={{
      fontSize: 10, color: 'rgba(255,255,255,0.55)',
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    }}>{!token ? 'no key' : `${radius} km`}</span>
  );

  return (
    <HFTile title="Recent birds" headRight={headRight} accent={accent} density={density} style={{ height: '100%' }}>
      <div style={{
        position: 'absolute', inset: 0, padding: 10,
        display: 'flex', flexDirection: 'column', gap: 6,
        overflow: 'hidden',
      }}>
        {loaded && !token && !(editing || setupOpen) && (
          <TileNeedsSetup
            accent={accent}
            line={
              <>
                Get a free eBird API key at{' '}
                <span style={{ color: accent, fontFamily: 'monospace' }}>ebird.org/api/keygen</span>
                .
              </>
            }
            onSetup={() => setSetupOpen(true)}
          />
        )}
        {loaded && !token && (editing || setupOpen) && (
          <ConnectPanel
            accent={accent}
            initialRadius={radius}
            onSave={(t, r) => {
              void saveToken(t); setStoredRadius(r);
              setRadius(r);
            }}
          />
        )}
        {token && error && <TileError line={error} onRetry={refresh} />}
        {token && !error && loading && obs.length === 0 && <TileSkeleton rows={4} />}
        {token && !error && !loading && obs.length === 0 && (
          <TileEmpty icon="◔" line="No recent observations." />
        )}
        {token && !error && obs.length > 0 && (
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
            {obs.slice(0, 30).map((o, i) => (
              <BirdRow key={`${o.speciesCode}-${i}`} obs={o} accent={accent} />
            ))}
          </div>
        )}
        {token && editing && (
          <button
            onClick={() => { void clearToken(); }}
            style={{
              padding: '4px 10px', fontSize: 10, fontWeight: 600, borderRadius: 4,
              background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.7)',
              border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer',
              alignSelf: 'flex-start', flexShrink: 0,
            }}
          >disconnect</button>
        )}
      </div>
    </HFTile>
  );
}

function BirdRow({ obs, accent }: { obs: BirdObservation; accent: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: 8,
      padding: '4px 6px', fontSize: 11.5,
      borderRadius: 4,
    }}>
      <span style={{
        flex: 1, color: '#fff', fontWeight: 600,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{obs.comName}</span>
      {obs.howMany != null && (
        <span style={{
          fontSize: 10, color: accent,
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          flexShrink: 0,
        }}>×{obs.howMany}</span>
      )}
      <span style={{
        fontSize: 9.5, color: 'rgba(255,255,255,0.45)',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        flexShrink: 0, maxWidth: 100,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{obs.locName}</span>
    </div>
  );
}

function ConnectPanel({
  accent, initialRadius, onSave,
}: { accent: string; initialRadius: number; onSave: (token: string, radius: number) => void }) {
  const [token, setToken] = useState('');
  const [radius, setRadius] = useState<number>(initialRadius);
  return (
    <div style={{
      flex: 1, padding: 8,
      display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center',
    }}>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5 }}>
        Get a free eBird API key at{' '}
        <span style={{ color: accent, fontFamily: 'monospace' }}>ebird.org/api/keygen</span>
        .
      </div>
      <input
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="eBird API key"
        style={inputStyle}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>Radius</span>
        <input
          type="range" min={5} max={50} step={5}
          value={radius}
          onChange={(e) => setRadius(Number(e.target.value))}
          style={{ flex: 1, accentColor: accent }}
        />
        <span style={{
          fontSize: 10, color: 'rgba(255,255,255,0.7)', minWidth: 36,
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        }}>{radius} km</span>
      </div>
      <button
        onClick={() => { if (token.trim()) onSave(token.trim(), radius); }}
        disabled={!token.trim()}
        style={{
          padding: '7px 12px', fontSize: 11, fontWeight: 700,
          background: token.trim() ? accent : 'rgba(255,255,255,0.06)',
          color: token.trim() ? '#000' : 'rgba(255,255,255,0.4)',
          border: 'none', borderRadius: 5,
          cursor: token.trim() ? 'pointer' : 'not-allowed',
        }}
      >Connect</button>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  fontSize: 11, padding: '6px 10px', borderRadius: 4,
  background: 'rgba(255,255,255,0.04)', color: '#fff',
  border: '1px solid rgba(255,255,255,0.1)',
  fontFamily: '"JetBrains Mono", ui-monospace, monospace', outline: 'none',
};
