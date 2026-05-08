import React, { useEffect, useState } from 'react';
import { HFTile } from './tiles';
import { type Quote, fetchQuoteOfTheDay } from '../state/quote';
import type { Density } from '../types';

const REFRESH_MS = 60 * 60 * 1000;

export function QuoteTile({ density, accent }: { density: Density; accent: string }) {
  const [quote, setQuote] = useState<Quote | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const q = await fetchQuoteOfTheDay();
      if (cancelled) return;
      if (q) setQuote(q);
    };
    void load();
    const id = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

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
