import React, { useEffect, useState } from 'react';
import { HFTile } from './tiles';
import {
  type PollenSample,
  fetchPollenSample,
  pollenLevel,
  smokeLevel,
} from '../state/pollen';
import { useSecret } from '../state/secrets';
import { usePoll } from '../state/usePoll';
import type { Density, WeatherLocation } from '../types';

const REFRESH_MS = 30 * 60 * 1000;

export interface PollenTileProps {
  density: Density;
  accent: string;
  editing: boolean;
  location: WeatherLocation;
}

const TIP_ROTATE_MS = 8000;

function PollenTileImpl({ density, accent, editing, location }: PollenTileProps) {
  const { value: token, loaded, save: saveToken, clear: clearToken } =
    useSecret('google_pollen_key', { legacyLocalStorageKey: '2mh.googlePollen.token' });
  const [tipIndex, setTipIndex] = useState(0);

  /* fetchPollenSample legitimately resolves to null (Open-Meteo down or no
   * pollen coverage) — that is data, not an error, so it is NOT promoted to a
   * throw. Real throws (e.g. Google rejecting the key) surface via `error`.
   * `token` in the deps makes saving/clearing a key refetch immediately, as
   * the old effect did. Until the secret store has loaded we don't know
   * whether a Google key exists, so hold off (returning null = "no data yet")
   * rather than firing a keyless fetch that would be redone immediately. */
  const { data, error } = usePoll<PollenSample | null>(
    async () => {
      if (!loaded) return null;
      return fetchPollenSample(location.lat, location.lon, token);
    },
    REFRESH_MS,
    [loaded, token, location.lat, location.lon],
  );
  const sample = data ?? null;

  // Cycle through health recommendations so the user sees all of them over
  // time without the tile growing tall enough to list them all.
  const tipCount = sample?.healthRecommendations.length ?? 0;
  useEffect(() => {
    setTipIndex(0);
    if (tipCount <= 1) return;
    const id = setInterval(() => setTipIndex((i) => (i + 1) % tipCount), TIP_ROTATE_MS);
    return () => clearInterval(id);
  }, [tipCount]);

  const smoke = smokeLevel(sample?.pm25 ?? null);
  // Pollen data is "missing" when all three indices are null. That's the case
  // for non-EU users without a Google key (Open-Meteo's CAMS pollen is EU-only).
  const hasPollenData = sample
    && (sample.grass != null || sample.tree != null || sample.weed != null);

  const headRight = (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <span style={{
        fontSize: 10, color: 'rgba(255,255,255,0.55)',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      }}>{location.label}</span>
      {sample?.source === 'google' && (
        <span style={{
          fontSize: 9, color: 'rgba(255,255,255,0.45)', padding: '1px 5px',
          borderRadius: 3, background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        }}>Google</span>
      )}
    </div>
  );

  return (
    <HFTile title="Pollen & smoke" headRight={headRight} accent={accent} density={density} style={{ height: '100%' }}>
      <div style={{
        position: 'absolute', inset: 0, padding: 12,
        display: 'flex', flexDirection: 'column', gap: 6,
        overflow: 'hidden',
      }}>
        {/* Wildfire smoke is universal — always rendered when we have a PM2.5
         *  reading, even before pollen is configured. */}
        {sample && sample.pm25 != null && (
          <div style={{
            padding: '8px 10px', borderRadius: 5,
            background: `${smoke.color}10`,
            border: `1px solid ${smoke.color}55`,
            display: 'flex', alignItems: 'center', gap: 10,
            flexShrink: 0,
          }}>
            <span style={{ fontSize: 22 }}>🔥</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 9, color: 'rgba(255,255,255,0.45)',
                textTransform: 'uppercase', letterSpacing: '.08em',
                fontFamily: '"JetBrains Mono", ui-monospace, monospace',
              }}>Wildfire smoke</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{
                  fontSize: 18, fontWeight: 700, color: smoke.color,
                  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                }}>
                  {sample.pm25.toFixed(1)}
                </span>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>µg/m³ PM2.5</span>
                <span style={{ fontSize: 10, color: smoke.color, fontWeight: 600, marginLeft: 'auto' }}>
                  {smoke.label}
                </span>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div style={{
            color: '#fca5a5', fontSize: 11, padding: 8,
            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
            borderRadius: 5,
          }}>
            {error}
          </div>
        )}

        {hasPollenData && (
          <>
            <div style={{
              flexShrink: 0,
              display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4,
            }}>
              <PollenCell label="Tree"  value={sample!.tree}  inSeason={sample!.treeInSeason}  />
              <PollenCell label="Grass" value={sample!.grass} inSeason={sample!.grassInSeason} />
              <PollenCell label="Weed"  value={sample!.weed}  inSeason={sample!.weedInSeason}  />
            </div>
            {sample!.healthRecommendations.length > 0 && (
              <div style={{
                flexShrink: 0,
                fontSize: 10, color: 'rgba(255,255,255,0.65)', lineHeight: 1.4,
                padding: '4px 6px',
                display: 'flex', alignItems: 'flex-start', gap: 6,
              }}>
                <span style={{ flexShrink: 0 }}>💡</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  {sample!.healthRecommendations[tipIndex % sample!.healthRecommendations.length]}
                </span>
              </div>
            )}
            {sample!.topPlants.length > 0 && (
              <div style={{
                flex: 1, minHeight: 0, overflowY: 'auto',
                display: 'flex', flexDirection: 'column', gap: 2,
              }}>
                <div style={{
                  fontSize: 9, color: 'rgba(255,255,255,0.45)',
                  textTransform: 'uppercase', letterSpacing: '.06em',
                  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                  paddingLeft: 4, marginTop: 2,
                }}>Top species today</div>
                {sample!.topPlants.map((p) => {
                  const lvl = pollenLevel(p.index);
                  return (
                    <div key={p.name} style={{
                      display: 'flex', alignItems: 'baseline', gap: 8,
                      padding: '3px 6px', fontSize: 11,
                    }}>
                      <span style={{ flex: 1, color: 'rgba(255,255,255,0.85)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.name}
                      </span>
                      <span style={{
                        fontSize: 10, color: lvl.color, fontWeight: 600,
                        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                      }}>{lvl.label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* No pollen data: the user is in a region Open-Meteo doesn't cover
         *  AND hasn't set up a Google Pollen key yet. Walk them through it. */}
        {loaded && sample && !hasPollenData && !token && (
          <ConnectPanel
            editing={editing}
            accent={accent}
            onSave={(t) => { void saveToken(t); }}
          />
        )}

        {sample && !hasPollenData && token && (
          <div style={{
            color: 'rgba(255,255,255,0.6)', fontSize: 11, padding: 8,
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 5, lineHeight: 1.5,
          }}>
            Pollen index unavailable for this location even with a key.
            Google's coverage is global but rural points sometimes return no
            forecast — try moving the saved location to the nearest city.
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

function PollenCell({ label, value, inSeason }: { label: string; value: number | null; inSeason: boolean | null }) {
  const lvl = pollenLevel(value);
  // When Google reports a zero count and explicitly flags the type as out of
  // season, "out of season" is more informative than the generic "none". For
  // sources that don't report seasonality (Open-Meteo) inSeason is null, so
  // we fall back to the band label.
  const labelText = (value === 0 && inSeason === false) ? 'out of season' : lvl.label;
  return (
    <div style={{
      padding: '6px 8px', borderRadius: 4,
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.06)',
      display: 'flex', flexDirection: 'column', gap: 2,
    }}>
      <div style={{
        fontSize: 9, color: 'rgba(255,255,255,0.5)',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        textTransform: 'uppercase', letterSpacing: '.05em',
      }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{
          fontSize: 18, fontWeight: 700, color: lvl.color,
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          lineHeight: 1,
        }}>{value != null ? value.toFixed(0) : '—'}</span>
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)' }}>/5</span>
      </div>
      <span style={{ fontSize: 10, color: lvl.color, fontWeight: 600 }}>{labelText}</span>
    </div>
  );
}

function ConnectPanel({
  editing, accent, onSave,
}: { editing: boolean; accent: string; onSave: (token: string) => void }) {
  const [token, setToken] = useState('');
  return (
    <div style={{
      flex: 1, padding: 8,
      display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center',
    }}>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5 }}>
        Detailed pollen needs a free Google Maps Platform API key (10K
        req/month free tier). Enable the{' '}
        <span style={{ color: accent, fontFamily: 'monospace' }}>Pollen API</span>{' '}
        at{' '}
        <span style={{ color: accent, fontFamily: 'monospace' }}>console.cloud.google.com</span>
        , create credentials, paste below.
      </div>
      {editing ? (
        <>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="AIza…"
            style={inputStyle}
          />
          <button
            onClick={() => { if (token.trim()) onSave(token.trim()); }}
            disabled={!token.trim()}
            style={{
              padding: '7px 12px', fontSize: 11, fontWeight: 700,
              background: token.trim() ? accent : 'rgba(255,255,255,0.06)',
              color: token.trim() ? '#000' : 'rgba(255,255,255,0.4)',
              border: 'none', borderRadius: 5,
              cursor: token.trim() ? 'pointer' : 'not-allowed',
            }}
          >Connect</button>
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
export const PollenTile = React.memo(PollenTileImpl);
