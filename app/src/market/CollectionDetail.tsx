import type { MutableRefObject } from 'react';
import type { CatalogItem } from '../state/catalog';
import type { SpectrumState } from '../state/tauri';
import type { Collection } from '../state/catalogShelves';
import { MarketCard } from './MarketCard';

/** One curated collection, as a page.
 *
 *  Members render as ordinary `MarketCard`s, so a collection is a shelf you
 *  can open rather than a separate object model — the same cards, the same
 *  detail route, one extra button.
 *
 *  Order is the collection's declared order, never re-sorted: curation is the
 *  entire point of a collection, and re-sorting it would discard the only
 *  thing it contributes over a facet. */
export function CollectionDetail({
  collection, items, accent, accent2, spectrumRef, appVersion, glyphOf, cardMin,
  onInstallAll, onOpen,
}: {
  collection: Collection | undefined;
  /** Resolved members, in the collection's declared order. */
  items: CatalogItem[];
  accent: string;
  accent2: string;
  spectrumRef?: MutableRefObject<SpectrumState>;
  appVersion: string;
  glyphOf: (item: CatalogItem) => string | null;
  cardMin: number;
  onInstallAll: () => void;
  onOpen: (item: CatalogItem) => void;
}) {
  if (!collection) {
    return (
      <div style={{ padding: 18, fontSize: 11.5, color: 'rgba(255,255,255,0.45)' }}>
        That collection is no longer published.
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.95)' }}>
            {collection.title}
          </div>
          {collection.blurb && (
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 5, lineHeight: 1.45 }}>
              {collection.blurb}
            </div>
          )}
        </div>
        {items.length > 0 && (
          <button
            onClick={onInstallAll}
            style={{
              padding: '6px 14px', fontSize: 12, fontWeight: 600, borderRadius: 7, flexShrink: 0,
              background: `${accent}22`, color: accent, border: `1px solid ${accent}44`,
              cursor: 'pointer',
            }}
          >Install all ({items.length})</button>
        )}
      </div>

      <div style={{
        display: 'grid', gap: 12, marginTop: 16,
        gridTemplateColumns: `repeat(auto-fill, minmax(${cardMin}px, 1fr))`,
      }}>
        {items.map((item) => (
          <MarketCard
            key={item.key}
            item={item}
            accent={accent}
            accent2={accent2}
            spectrumRef={spectrumRef}
            appVersion={appVersion}
            glyph={glyphOf(item)}
            onOpen={() => onOpen(item)}
          />
        ))}
      </div>

      {items.length === 0 && (
        // A collection naming only unknown bundles renders empty rather than
        // erroring — the server's list is not validated against this client's
        // index, and a missing member is a curation problem, not a crash.
        <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', marginTop: 16 }}>
          None of this collection's bundles are in the catalog right now.
        </div>
      )}
    </div>
  );
}
