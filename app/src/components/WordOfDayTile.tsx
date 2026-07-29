import React from 'react';
import { HFTile } from './tiles';
import { type WordEntry, fetchWordEntry, wordForToday } from '../state/wordOfDay';
import { usePoll } from '../state/usePoll';
import type { Density } from '../types';

const REFRESH_MS = 6 * 60 * 60 * 1000; // 6h — date-seeded so same word per day anyway

export function WordOfDayTile({ density, accent }: { density: Density; accent: string }) {
  const { data: entry, loading } = usePoll<WordEntry>(
    async () => {
      const e = await fetchWordEntry(wordForToday());
      if (e == null) throw new Error('fetch failed');
      return e;
    },
    REFRESH_MS,
  );

  return (
    <HFTile title="Word of the day" accent={accent} density={density} style={{ height: '100%' }}>
      <div style={{
        position: 'absolute', inset: 0, padding: 12,
        display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center',
        overflow: 'hidden',
      }}>
        {!entry && loading && (
          <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, fontStyle: 'italic' }}>
            Loading…
          </div>
        )}
        {!entry && !loading && (
          <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11 }}>
            Couldn't load today's word.
          </div>
        )}
        {entry && (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{
                fontSize: 22, fontWeight: 700, color: '#fff',
              }}>{entry.word}</span>
              {entry.phonetic && (
                <span style={{
                  fontSize: 11, color: 'rgba(255,255,255,0.5)',
                  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                }}>{entry.phonetic}</span>
              )}
              {entry.partOfSpeech && (
                <span style={{
                  fontSize: 9, color: accent,
                  padding: '1px 6px', borderRadius: 3,
                  background: `${accent}15`, border: `1px solid ${accent}33`,
                  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                  textTransform: 'lowercase',
                }}>{entry.partOfSpeech}</span>
              )}
            </div>
            <div style={{
              fontSize: 12, lineHeight: 1.5, color: 'rgba(255,255,255,0.85)',
              overflow: 'hidden',
              display: '-webkit-box', WebkitLineClamp: 4 as any, WebkitBoxOrient: 'vertical' as any,
            }}>{entry.definition}</div>
            {entry.example && (
              <div style={{
                fontSize: 11, fontStyle: 'italic', color: 'rgba(255,255,255,0.55)',
                paddingLeft: 10, borderLeft: `2px solid ${accent}55`,
                overflow: 'hidden',
                display: '-webkit-box', WebkitLineClamp: 2 as any, WebkitBoxOrient: 'vertical' as any,
              }}>{entry.example}</div>
            )}
          </>
        )}
      </div>
    </HFTile>
  );
}
