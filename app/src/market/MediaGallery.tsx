import { useEffect, useState, type ReactNode } from 'react';
import type { CatalogItem } from '../state/catalog';
import { mediaRefsFor, hasGallery } from '../state/mediaList';
import { PreviewImage } from '../components/PreviewImage';
import { PREVIEW_ASPECT } from '../components/previewSource';
import { cfgUrl } from '../state/marketplaceConfig';

/** Hero asset plus a thumbnail strip when there is more than one.
 *
 *  Fallback chain unchanged in spirit from the cards': asset → glyph →
 *  letter block, and a failed fetch is silent, exactly like a missing preview
 *  image today.
 *
 *  Nothing here replaces a live render — MarketDetail puts the two side by
 *  side. A live sandbox and the published gallery answer different questions:
 *  "what does this do right now on my machine" versus "what did the author
 *  intend to show". An uninstalled bundle has only the gallery, which is
 *  precisely why finding 31 concluded live rendering is not a substitute for
 *  published images. */
export function MediaGallery({ item, accent, fallback }: {
  item: CatalogItem;
  accent: string;
  /** Glyph or letter block, shown when there is no asset or a fetch fails. */
  fallback: ReactNode;
}) {
  const refs = mediaRefsFor(item);
  const [active, setActive] = useState(0);

  // A different item means a different asset list; keeping the old index
  // would open the new item on whatever slot the last one happened to be on.
  useEffect(() => { setActive(0); }, [item.key]);

  if (refs.length === 0 || item.availableVersion == null) {
    return (
      <div style={frameStyle(accent)}>{fallback}</div>
    );
  }

  const strip = hasGallery(item);

  return (
    <div
      tabIndex={strip ? 0 : undefined}
      onKeyDown={(e) => {
        if (!strip) return;
        if (e.key === 'ArrowRight') { e.preventDefault(); setActive((i) => Math.min(refs.length - 1, i + 1)); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
      }}
      style={{ outline: 'none' }}
    >
      <div style={frameStyle(accent)}>
        <PreviewImage
          id={item.id}
          version={item.availableVersion}
          kind={item.kind}
          idx={refs[active]?.idx ?? 0}
          url={cfgUrl()}
          fallback={fallback}
        />
      </div>

      {strip && (
        <div style={{ display: 'flex', gap: 6, marginTop: 8, overflowX: 'auto' }}>
          {refs.map((r, i) => (
            <button
              key={r.idx}
              onClick={() => setActive(i)}
              aria-label={`Show asset ${i + 1}`}
              style={{
                width: 72, height: 41, flexShrink: 0, padding: 0, overflow: 'hidden',
                borderRadius: 6, cursor: 'pointer',
                background: `linear-gradient(135deg, ${accent}22, ${accent}08)`,
                border: i === active ? `1px solid ${accent}aa` : '1px solid rgba(255,255,255,0.09)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <PreviewImage
                id={item.id}
                version={item.availableVersion!}
                kind={item.kind}
                idx={r.idx}
                url={cfgUrl()}
                fallback={fallback}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const frameStyle = (accent: string) => ({
  aspectRatio: PREVIEW_ASPECT, borderRadius: 12, overflow: 'hidden',
  background: `linear-gradient(135deg, ${accent}22, ${accent}08)`,
  border: `1px solid ${accent}2a`,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
} as const);
