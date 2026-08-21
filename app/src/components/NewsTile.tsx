import React, { useMemo, useState } from 'react';
import { HFTile } from './tiles';
import {
  type Headline, type NewsCategory, type NewsRegion,
  NEWS_CATEGORIES, NEWS_REGIONS, fetchNewsHeadlines, parseNewsConfig, headlineAge, sourceBadge,
} from '../state/news';
import { usePoll } from '../state/usePoll';
import { TileSkeleton } from './tileStates';
import { appActions } from '../state/tauri';
import type { Density } from '../types';

/** RSS is cached hard by both publishers; 10 minutes is polite and plenty. */
const REFRESH_MS = 10 * 60 * 1000;

const MONO = '"JetBrains Mono", ui-monospace, monospace';

export interface NewsTileProps {
  instanceId: string;
  density: Density;
  accent: string;
  editing: boolean;
  config: Record<string, unknown> | undefined;
  setConfig: (next: Record<string, unknown>) => void;
}

function NewsTileImpl({ density, accent, editing, config, setConfig }: NewsTileProps) {
  const parsed = useMemo(() => parseNewsConfig(config), [config]);
  const { data, error, loading } = usePoll(
    () => fetchNewsHeadlines(parsed.category, parsed.region),
    REFRESH_MS,
    [parsed.category, parsed.region],
  );
  const headlines: Headline[] = data?.headlines ?? [];
  const feedError = error ?? data?.error ?? null;
  const [now] = useState(() => Date.now()); // ages re-derive on each poll render

  const setCategory = (category: NewsCategory) => {
    // Spread the existing blob — instance.config is shared storage, and
    // clobbering unknown keys is the bug class parseRadarConfig documents.
    setConfig({ ...(config ?? {}), category });
  };

  const label = NEWS_CATEGORIES.find((c) => c.id === parsed.category)?.label ?? 'News';
  const regionDef = NEWS_REGIONS.find((r) => r.id === parsed.region) ?? NEWS_REGIONS[0];
  const setRegion = (region: NewsRegion) => setConfig({ ...(config ?? {}), region });

  // Region picker (0.9.14) replaces the hardcoded "BBC · Guardian" label;
  // the publisher list is derived from the selected region.
  const headRight = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', fontFamily: MONO }}>
        {regionDef.publishers.join(' · ')}
      </span>
      <div style={{ display: 'flex', gap: 2 }}>
        {NEWS_REGIONS.map((r) => {
          const on = r.id === parsed.region;
          return (
            <button
              key={r.id}
              onClick={() => setRegion(r.id)}
              data-no-drag
              title={`${r.label} publishers: ${r.publishers.join(', ')}`}
              style={{
                padding: '1px 6px', fontSize: 9, fontFamily: MONO, fontWeight: on ? 700 : 400,
                borderRadius: 'var(--control-radius, 4px)', cursor: 'pointer',
                background: on ? `${accent}22` : 'transparent',
                color: on ? accent : 'rgba(255,255,255,0.45)',
                border: `1px solid ${on ? `${accent}55` : 'rgba(255,255,255,0.1)'}`,
              }}
            >{r.label}</button>
          );
        })}
      </div>
    </div>
  );

  return (
    <HFTile title={`News · ${label}`} headRight={headRight} accent={accent} density={density} style={{ height: '100%' }}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {/* Category strip — always visible, not gated on edit mode: switching
            what you read is daily use, not layout configuration. */}
        <div style={{
          display: 'flex', gap: 4, padding: '6px 10px', flexWrap: 'wrap', flexShrink: 0,
          borderBottom: '1px solid rgba(255,255,255,0.05)',
        }}>
          {NEWS_CATEGORIES.map((c) => {
            const on = c.id === parsed.category;
            return (
              <button
                key={c.id}
                onClick={() => setCategory(c.id)}
                data-no-drag
                style={{
                  padding: '2px 8px', fontSize: 9.5, fontFamily: MONO, fontWeight: on ? 700 : 400,
                  borderRadius: 999, cursor: 'pointer',
                  background: on ? `${accent}22` : 'transparent',
                  color: on ? accent : 'rgba(255,255,255,0.5)',
                  border: `1px solid ${on ? `${accent}55` : 'rgba(255,255,255,0.1)'}`,
                }}
              >{c.label}</button>
            );
          })}
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 0' }}>
          {loading && headlines.length === 0 && <TileSkeleton rows={5} />}
          {!loading && headlines.length === 0 && (
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', padding: 12, lineHeight: 1.5 }}>
              {feedError
                ? <>Couldn’t reach the news feeds — {feedError}. The tile keeps retrying.</>
                : 'No headlines right now.'}
            </div>
          )}
          {headlines.map((h, i) => {
            const age = headlineAge(h.published, now);
            return (
              <button
                key={`${h.link}-${i}`}
                onClick={() => { if (!editing) void appActions.openUrl(h.link); }}
                data-no-drag
                title={h.title}
                style={{
                  display: 'flex', alignItems: 'baseline', gap: 8, width: '100%',
                  padding: '5px 12px', background: 'transparent', border: 'none',
                  cursor: editing ? 'default' : 'pointer', textAlign: 'left',
                }}
              >
                <span style={{
                  fontSize: 9, fontFamily: MONO, fontWeight: 700, flexShrink: 0,
                  color: regionDef.publishers.indexOf(h.source as never) === 0 ? '#fca5a5' : accent, minWidth: 26,
                }}>{sourceBadge(h.source)}</span>
                <span style={{
                  fontSize: 11.5, color: 'rgba(255,255,255,0.85)', lineHeight: 1.4,
                  flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                }}>{h.title}</span>
                {age && (
                  <span style={{ fontSize: 9, fontFamily: MONO, color: 'rgba(255,255,255,0.35)', flexShrink: 0 }}>
                    {age}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </HFTile>
  );
}

/** Memoised (0.7.3 P2): App re-renders on any tweak change, and this tile's
 *  props are primitives or stable identities, so it can bail out. */
export const NewsTile = React.memo(NewsTileImpl);
