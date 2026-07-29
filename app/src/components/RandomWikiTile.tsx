import React from 'react';
import { HFTile } from './tiles';
import { appActions } from '../state/tauri';
import { type WikiArticle, fetchRandomArticle } from '../state/randomWiki';
import { usePoll } from '../state/usePoll';
import type { Density } from '../types';

const REFRESH_MS = 60 * 60 * 1000;

export function RandomWikiTile({ density, accent }: { density: Density; accent: string }) {
  const { data: article, loading, refresh } = usePoll<WikiArticle>(
    async () => {
      const a = await fetchRandomArticle();
      if (a == null) throw new Error('fetch failed');
      return a;
    },
    REFRESH_MS,
  );

  const headRight = (
    <button
      onClick={refresh}
      title="New article"
      style={{
        padding: '3px 8px', fontSize: 10, fontWeight: 600, borderRadius: 4,
        background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.7)',
        border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      }}
    >↻</button>
  );

  return (
    <HFTile title="Random Wikipedia" headRight={headRight} accent={accent} density={density} style={{ height: '100%' }}>
      <div
        onClick={() => { if (article?.url) void appActions.openUrl(article.url); }}
        style={{
          position: 'absolute', inset: 0, padding: 12,
          display: 'flex', gap: 12,
          overflow: 'hidden',
          cursor: article?.url ? 'pointer' : 'default',
        }}
      >
        {article?.thumbnailUrl && (
          <img
            src={article.thumbnailUrl}
            alt=""
            style={{
              width: 96, height: 96, objectFit: 'cover', borderRadius: 6,
              flexShrink: 0,
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {!article && loading && (
            <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, fontStyle: 'italic' }}>
              Loading…
            </div>
          )}
          {article && (
            <>
              <div style={{
                fontSize: 14, fontWeight: 700, color: '#fff',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{article.title}</div>
              <div style={{
                fontSize: 11.5, lineHeight: 1.5, color: 'rgba(255,255,255,0.78)',
                overflow: 'hidden',
                display: '-webkit-box', WebkitLineClamp: 5 as any, WebkitBoxOrient: 'vertical' as any,
              }}>{article.extract}</div>
            </>
          )}
        </div>
      </div>
    </HFTile>
  );
}
