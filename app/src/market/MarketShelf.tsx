import type { MutableRefObject } from 'react';
import type { CatalogItem } from '../state/catalog';
import type { SpectrumState } from '../state/tauri';
import type { Shelf } from '../state/catalogShelves';
import { MarketCard } from './MarketCard';

const MONO = '"JetBrains Mono", ui-monospace, monospace';

/** One horizontally scrolling row of the Discover home.
 *
 *  "see all" dispatches the shelf's OWN declared `{facets, sort}` rather than
 *  a re-derived guess, so a shelf and the grid it opens cannot disagree about
 *  what they contain. */
export function MarketShelf({
  shelf, accent, accent2, spectrumRef, appVersion, glyphOf, cardMin, onSeeAll, onOpen,
}: {
  shelf: Shelf;
  accent: string;
  accent2: string;
  spectrumRef?: MutableRefObject<SpectrumState>;
  appVersion: string;
  glyphOf: (item: CatalogItem) => string | null;
  cardMin: number;
  onSeeAll: () => void;
  onOpen: (item: CatalogItem) => void;
}) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>
          {shelf.title}
        </span>
        <span style={{ fontSize: 9.5, fontFamily: MONO, color: 'rgba(255,255,255,0.3)' }}>
          {shelf.items.length}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={onSeeAll}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: accent, fontSize: 11, fontWeight: 600, padding: 0,
          }}
        >see all ›</button>
      </div>
      <div style={{
        display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 6,
        scrollbarWidth: 'thin',
      }}>
        {shelf.items.map((item) => (
          <div key={item.key} style={{ width: cardMin, flexShrink: 0 }}>
            <MarketCard
              item={item}
              accent={accent}
              accent2={accent2}
              spectrumRef={spectrumRef}
              appVersion={appVersion}
              glyph={glyphOf(item)}
              onOpen={() => onOpen(item)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
