import React from 'react';
import { HFTile } from './tiles';
import { type Quote, fetchQuoteOfTheDay } from '../state/quote';
import { usePoll } from '../state/usePoll';
import type { Density } from '../types';

const REFRESH_MS = 60 * 60 * 1000;

export function QuoteTile({ density, accent }: { density: Density; accent: string }) {
  /* fetchQuoteOfTheDay owns the day-keyed localStorage cache — it serves the
   * cached quote for today and only hits the network on a new day. */
  const { data: quote } = usePoll<Quote>(
    async () => {
      const q = await fetchQuoteOfTheDay();
      if (q == null) throw new Error('fetch failed');
      return q;
    },
    REFRESH_MS,
  );

  return (
    <HFTile title="Quote of the day" accent={accent} density={density} style={{ height: '100%' }}>
      <div style={{
        position: 'absolute', inset: 0, padding: 14,
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        gap: 10, overflow: 'hidden',
      }}>
        {!quote && (
          <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, fontStyle: 'italic' }}>
            Loading…
          </div>
        )}
        {quote && (
          <>
            <div style={{
              fontSize: 14, lineHeight: 1.5, color: 'rgba(255,255,255,0.92)',
              fontStyle: 'italic',
              overflow: 'hidden',
              display: '-webkit-box', WebkitLineClamp: 6 as any, WebkitBoxOrient: 'vertical' as any,
            }}>
              "{quote.text}"
            </div>
            <div style={{
              fontSize: 11, color: accent,
              fontFamily: '"JetBrains Mono", ui-monospace, monospace',
              textAlign: 'right',
            }}>— {quote.author}</div>
          </>
        )}
      </div>
    </HFTile>
  );
}
