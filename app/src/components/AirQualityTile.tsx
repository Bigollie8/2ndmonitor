import React from 'react';
import { HFTile } from './tiles';
import {
  aqiCategory,
  fetchAirQuality,
  uvCategory,
} from '../state/airquality';
import { usePoll } from '../state/usePoll';
import type { Density, WeatherLocation } from '../types';

const REFRESH_MS = 15 * 60 * 1000;

export interface AirQualityTileProps {
  density: Density;
  accent: string;
  location: WeatherLocation;
}

function AirQualityTileImpl({ density, accent, location }: AirQualityTileProps) {
  // fetchAirQuality returns null on failure; throw so usePoll backs off while
  // keeping the last good sample visible.
  const { data: sample } = usePoll(
    async () => {
      const s = await fetchAirQuality(location.lat, location.lon);
      if (s == null) throw new Error('fetch failed');
      return s;
    },
    REFRESH_MS,
    [location.lat, location.lon],
  );

  const aqi = aqiCategory(sample?.usAqi ?? null);
  const uv = uvCategory(sample?.uvIndex ?? null);
  const aqiText = sample?.usAqi != null ? Math.round(sample.usAqi).toString() : '—';
  const uvText = sample?.uvIndex != null ? sample.uvIndex.toFixed(1) : '—';
  const pm25 = sample?.pm25 != null ? sample.pm25.toFixed(1) : '—';
  const pm10 = sample?.pm10 != null ? sample.pm10.toFixed(1) : '—';

  const headRight = (
    <span style={{
      fontSize: 10, color: 'rgba(255,255,255,0.55)',
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    }}>{location.label}</span>
  );

  const hint = aqi.hint || uv.hint;

  return (
    <HFTile title="Air & UV" headRight={headRight} accent={accent} density={density} style={{ height: '100%' }}>
      <div style={{
        position: 'absolute', inset: 0, padding: 12,
        display: 'flex', flexDirection: 'column', gap: 8,
        overflow: 'hidden',
      }}>
        {/* Big AQI + UV side-by-side */}
        <div style={{ display: 'flex', gap: 14, flex: 1, minHeight: 0 }}>
          <Pillar
            label="AQI" value={aqiText} category={aqi.label} color={aqi.color}
            sub={`PM2.5 ${pm25} · PM10 ${pm10}`}
          />
          <div style={{ width: 1, background: 'rgba(255,255,255,0.06)' }} />
          <Pillar
            label="UV" value={uvText} category={uv.label} color={uv.color}
            sub={uvText !== '—' ? 'index now' : ''}
          />
        </div>

        {/* Health hint, only when something non-trivial to say */}
        {hint && (
          <div style={{
            fontSize: 10, color: 'rgba(255,255,255,0.6)',
            padding: '5px 8px', borderRadius: 5,
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.06)',
            lineHeight: 1.4,
            flexShrink: 0,
          }}>
            {hint}
          </div>
        )}
      </div>
    </HFTile>
  );
}

function Pillar({
  label, value, category, color, sub,
}: { label: string; value: string; category: string; color: string; sub: string }) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      justifyContent: 'center', minWidth: 0, gap: 2,
    }}>
      <span style={{
        fontSize: 9, color: 'rgba(255,255,255,0.45)',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        letterSpacing: '0.08em', textTransform: 'uppercase',
      }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{
          fontSize: 32, fontWeight: 700, color,
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          lineHeight: 1,
        }}>{value}</span>
      </div>
      <span style={{
        fontSize: 11, fontWeight: 600, color,
        marginTop: 2,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{category}</span>
      {sub && (
        <span style={{
          fontSize: 9, color: 'rgba(255,255,255,0.5)',
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          marginTop: 2,
        }}>{sub}</span>
      )}
    </div>
  );
}

/** Memoised (0.7.3 P2): App re-renders on any tweak change, and this tile's
 *  props are primitives or stable identities, so it can bail out. */
export const AirQualityTile = React.memo(AirQualityTileImpl);
