import React, { useRef } from 'react';
import { HFTile } from './tiles';
import {
  SUN_IMAGE_URL,
  fetchSolarXray,
  flareSeverity,
} from '../state/solarFlare';
import { usePoll } from '../state/usePoll';
import type { Density } from '../types';

const REFRESH_MS = 5 * 60 * 1000;

function SolarFlareTileImpl({ density, accent }: { density: Density; accent: string }) {
  const { data } = usePoll(
    async () => {
      const r = await fetchSolarXray();
      if (r == null) throw new Error('fetch failed');
      // Cache-buster so the SDO image refreshes alongside the X-ray reading.
      return { reading: r, imageBust: Date.now() };
    },
    REFRESH_MS,
    [],
    'Solar activity',
  );
  /* Bust value for the initial render, before the first reading lands, so the
   * image URL stays stable across re-renders instead of reloading each time. */
  const initialBust = useRef(Date.now());
  const reading = data?.reading ?? null;
  const imageBust = data?.imageBust ?? initialBust.current;

  const severity = reading ? flareSeverity(reading.classLetter) : null;

  const headRight = (
    <span style={{
      fontSize: 10, color: 'rgba(255,255,255,0.55)',
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    }}>{reading ? reading.observedAt.slice(11, 16) + ' UT' : '—'}</span>
  );

  return (
    <HFTile title="Sun · X-ray" headRight={headRight} accent={accent} density={density} style={{ height: '100%' }}>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Sun image */}
        <div style={{
          flex: 1, minHeight: 0, position: 'relative',
          background: '#000',
        }}>
          <img
            src={`${SUN_IMAGE_URL}?ts=${imageBust}`}
            alt="SDO AIA 304Å"
            style={{
              position: 'absolute', inset: 0, margin: 'auto',
              maxWidth: '100%', maxHeight: '100%',
              objectFit: 'contain',
              display: 'block',
              imageRendering: 'auto',
            }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        </div>
        {/* Class + severity */}
        <div style={{
          padding: '8px 12px', flexShrink: 0,
          display: 'flex', alignItems: 'baseline', gap: 10,
          borderTop: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(0,0,0,0.4)',
        }}>
          {reading && severity ? (
            <>
              <span style={{
                fontSize: 22, fontWeight: 700, color: severity.color,
                fontFamily: '"JetBrains Mono", ui-monospace, monospace',
              }}>{reading.className}</span>
              <span style={{
                fontSize: 11, color: severity.color, fontWeight: 600,
              }}>{severity.label}</span>
              <span style={{
                fontSize: 9, color: 'rgba(255,255,255,0.4)', marginLeft: 'auto',
                fontFamily: '"JetBrains Mono", ui-monospace, monospace',
              }}>{reading.flux.toExponential(1)} W/m²</span>
            </>
          ) : (
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>Loading flux…</span>
          )}
        </div>
      </div>
    </HFTile>
  );
}

/** Memoised (0.7.3 P2): App re-renders on any tweak change, and this tile's
 *  props are primitives or stable identities, so it can bail out. */
export const SolarFlareTile = React.memo(SolarFlareTileImpl);
