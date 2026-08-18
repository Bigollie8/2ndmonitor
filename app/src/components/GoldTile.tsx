import React from 'react';
import { HFTile } from './tiles';
import { fetchStockQuotes } from '../state/stocks';
import { goldPricing, GOLD_SYMBOL } from '../state/gold';
import { usePoll } from '../state/usePoll';
import { TileEmpty, TileSkeleton } from './tileStates';
import type { Density } from '../types';

const REFRESH_MS = 60 * 1000; // same cadence as the Stocks tile

const MONO = '"JetBrains Mono", ui-monospace, monospace';

export interface GoldTileProps {
  density: Density;
  accent: string;
}

/** 24K gold spot in both units the reporter asked for — USD per troy ounce
 *  straight from the quote, USD per gram derived (see state/gold.ts for why
 *  spot ÷ 31.1035 IS the 24K gram price). Rides the existing Yahoo proxy. */
function GoldTileImpl({ density, accent }: GoldTileProps) {
  const { data, loading } = usePoll(
    () => fetchStockQuotes([GOLD_SYMBOL]),
    REFRESH_MS,
    [],
  );
  const quote = data?.find((q) => q.symbol === GOLD_SYMBOL) ?? data?.[0];
  const gold = goldPricing(quote);

  const changeColor = gold?.changePct == null ? 'rgba(255,255,255,0.4)'
    : gold.changePct > 0 ? '#22c55e' : (gold.changePct < 0 ? '#ef4444' : 'rgba(255,255,255,0.7)');

  const headRight = (
    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', fontFamily: MONO }}>
      24K spot · USD
    </span>
  );

  return (
    <HFTile title="Gold" headRight={headRight} accent={accent} density={density} style={{ height: '100%' }}>
      <div style={{
        position: 'absolute', inset: 0, padding: 12,
        display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8,
      }}>
        {loading && !gold && <TileSkeleton rows={2} />}
        {!loading && !gold && (
          <TileEmpty
            icon="◉"
            line={quote?.error ? `Quote failed: ${quote.error}` : 'No gold quote — check your connection.'}
          />
        )}
        {gold && (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{
                fontSize: 30, fontWeight: 700, color: '#fff', lineHeight: 1,
                fontFamily: 'var(--font-display, "JetBrains Mono", ui-monospace, monospace)',
                letterSpacing: '-0.02em',
              }}>${gold.perOz.toFixed(2)}</span>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontFamily: MONO }}>/ oz t</span>
              <span style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 600, color: changeColor, fontFamily: MONO }}>
                {gold.changePct == null ? '' : `${gold.changePct >= 0 ? '+' : ''}${gold.changePct.toFixed(2)}%`}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{
                fontSize: 20, fontWeight: 600, color: 'rgba(255,255,255,0.85)', lineHeight: 1,
                fontFamily: MONO, letterSpacing: '-0.01em',
              }}>${gold.perGram.toFixed(2)}</span>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontFamily: MONO }}>/ gram</span>
            </div>
          </>
        )}
      </div>
    </HFTile>
  );
}

export const GoldTile = React.memo(GoldTileImpl);
