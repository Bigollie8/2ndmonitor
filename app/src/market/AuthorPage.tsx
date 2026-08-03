import type { MutableRefObject } from 'react';
import type { CatalogItem } from '../state/catalog';
import type { SpectrumState } from '../state/tauri';
import type { AuthorSummary } from '../state/authorIndex';
import { sortItems } from '../state/catalogSort';
import { MarketCard } from './MarketCard';

const MONO = '"JetBrains Mono", ui-monospace, monospace';

/** One publisher's bundles.
 *
 *  Derived entirely from the merged catalog (state/authorIndex.ts) — there is
 *  no author endpoint, because the index already carries an author per bundle.
 *
 *  The heading is `authorDisplay`, which is the server's `users.display_name`
 *  falling back to the masked email. Nothing in Market v2 gives an author a
 *  way to SET a display name — there is no claim flow, only an admin PATCH —
 *  so most pages ship titled "oli***" until someone sets them by hand. That
 *  is a known limitation, not an oversight. */
export function AuthorPage({
  summary, accent, accent2, spectrumRef, appVersion, glyphOf, cardMin, onOpen,
}: {
  summary: AuthorSummary | undefined;
  accent: string;
  accent2: string;
  spectrumRef?: MutableRefObject<SpectrumState>;
  appVersion: string;
  glyphOf: (item: CatalogItem) => string | null;
  cardMin: number;
  onOpen: (item: CatalogItem) => void;
}) {
  if (!summary) {
    return (
      <div style={{ padding: 18, fontSize: 11.5, color: 'rgba(255,255,255,0.45)' }}>
        That author has nothing in the catalog right now.
      </div>
    );
  }

  const items = sortItems(summary.items, 'installs');

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.95)' }}>
        {summary.author}
      </div>
      <div style={{ fontSize: 11, fontFamily: MONO, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
        {items.length} bundle{items.length === 1 ? '' : 's'} · {summary.totalDownloads} installs
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
    </div>
  );
}
