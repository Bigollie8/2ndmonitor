import { useState, type MutableRefObject } from 'react';
import type { CatalogItem } from '../state/catalog';
import type { SpectrumState } from '../state/tauri';
import { previewSourceFor, canLivePreview, PREVIEW_ASPECT } from '../components/previewSource';
import { PreviewImage } from '../components/PreviewImage';
import { LivePreview } from '../components/LivePreview';
import { StarRating } from '../components/StarRating';
import { catalogCardTags } from '../state/catalogTags';
import { permissionBadges } from '../state/permissionBadges';
import { isCompatible } from '../state/appCompat';
import { cfgUrl } from '../state/marketplaceConfig';

const MONO = '"JetBrains Mono", ui-monospace, monospace';

/** A marketplace bundle's declared glyph wins; a built-in falls back to its
 *  TILE_META icon; anything else gets the first letter of its name. Note the
 *  project rule in state/tileMeta.ts — icons are geometric glyphs, never
 *  emoji — which the server cannot enforce, so a bundle declaring an emoji is
 *  a curation problem fixed with an admin PATCH, not a client-side filter. */
export const glyphFor = (item: CatalogItem, tileGlyph: string | null): string =>
  item.icon ?? tileGlyph ?? (item.name.trim().charAt(0).toUpperCase() || '?');

/** One item in a store grid or shelf. Bigger than `CatalogCard`: a 16:9
 *  preview rather than a 46px strip, plus the summary, permission badges and
 *  the install count.
 *
 *  The whole card's action is OPEN DETAIL — install happens there, not here.
 *  That is the discovery/management split: a card invites you to look, it
 *  does not ask you to commit. */
export function MarketCard({
  item, accent, accent2, spectrumRef, appVersion, glyph: tileGlyph, selected, onOpen,
}: {
  item: CatalogItem;
  accent: string;
  accent2: string;
  spectrumRef?: MutableRefObject<SpectrumState>;
  appVersion: string;
  /** `TILE_META[id].icon` for a built-in tile, `null` for everything else. */
  glyph: string | null;
  /** Keyboard selection highlight — see MarketGrid's arrow navigation. */
  selected?: boolean;
  onOpen: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const tags = catalogCardTags(item);
  const badges = permissionBadges(item.permissions);
  const compatible = isCompatible(item.minAppVersion, appVersion);
  const glyph = glyphFor(item, tileGlyph);

  const fallbackContent = (
    <span style={{ fontSize: 34, fontWeight: 700, color: `${accent}cc` }}>{glyph}</span>
  );
  const previewSrc = previewSourceFor(item, tileGlyph);
  const baselineContent = previewSrc.kind === 'image' && item.availableVersion != null ? (
    <PreviewImage
      id={item.id}
      version={item.availableVersion}
      kind={item.kind}
      url={cfgUrl()}
      fallback={fallbackContent}
    />
  ) : fallbackContent;
  // Hover-gated, exactly as CatalogCard does it. Opening the store must mount
  // ZERO sandboxes: the ambient six-sandbox treatment was the marketplace-open
  // near-crash in deferred finding #31, and a full-bleed grid shows MORE cards
  // at once than the old modal did, not fewer.
  const live = hovered && canLivePreview(item);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); }
      }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      title={item.summary ?? item.description}
      style={{
        display: 'flex', flexDirection: 'column', gap: 8,
        padding: 10, borderRadius: 12, minWidth: 0, cursor: 'pointer',
        background: item.installed ? `${accent}08` : 'rgba(255,255,255,0.03)',
        border: selected
          ? `1px solid ${accent}aa`
          : item.installed ? `1px solid ${accent}33` : '1px solid rgba(255,255,255,0.07)',
        boxShadow: selected ? `0 0 0 1px ${accent}55` : undefined,
        outline: 'none',
      }}
    >
      <div style={{
        // The capture stage's shape, NOT 16:9 — see PREVIEW_ASPECT. A 16:9
        // frame plus object-fit:cover sliced ~40% off every preview's width.
        aspectRatio: PREVIEW_ASPECT, borderRadius: 8, overflow: 'hidden', flexShrink: 0,
        background: `linear-gradient(135deg, ${accent}22, ${accent}08)`,
        border: `1px solid ${accent}2a`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {live ? (
          <LivePreview
            bundleId={item.id}
            accent={accent}
            accent2={accent2}
            spectrumRef={spectrumRef}
            fallback={baselineContent}
          />
        ) : baselineContent}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
        <span style={{
          fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.92)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
        }}>{item.name}</span>
        {tags.map((t) => (
          <span key={t.text} style={{
            fontSize: 8.5, fontFamily: MONO, fontWeight: 700, letterSpacing: '0.05em',
            padding: '2px 5px', borderRadius: 4, flexShrink: 0,
            color: t.color, background: t.bg, textTransform: 'uppercase',
          }}>{t.text}</span>
        ))}
      </div>

      {/* Summary is the whole reason Phase 1 exists. Until Phase 6 backfills
          it most bundles have none — the description line below stands in,
          which is what the catalog showed before. */}
      <div style={{
        fontSize: 11, lineHeight: 1.35, color: 'rgba(255,255,255,0.55)',
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        overflow: 'hidden', minHeight: 30,
      }}>{item.summary ?? item.description}</div>

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {badges.map((b) => (
          <span key={b.text} title={b.title} style={{
            fontSize: 8.5, fontFamily: MONO, fontWeight: 700, letterSpacing: '0.05em',
            padding: '2px 5px', borderRadius: 4, textTransform: 'uppercase',
            color: b.tone === 'warn' ? '#fbbf24' : 'rgba(255,255,255,0.5)',
            background: b.tone === 'warn' ? 'rgba(245,158,11,0.12)' : 'rgba(255,255,255,0.05)',
          }}>{b.text}</span>
        ))}
        {!compatible && (
          <span title={`Requires app ${item.minAppVersion}`} style={{
            fontSize: 8.5, fontFamily: MONO, fontWeight: 700, letterSpacing: '0.05em',
            padding: '2px 5px', borderRadius: 4, textTransform: 'uppercase',
            color: '#ff9b9b', background: 'rgba(255,90,90,0.14)',
          }}>needs {item.minAppVersion}</span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Read-only here: rating happens in the detail view, where the click
            target is not also the card's own open action. */}
        <StarRating
          rating={item.rating}
          signedIn={false}
          ratable={false}
          busy={false}
          onRate={() => {}}
        />
        <div style={{ flex: 1 }} />
        {item.downloads != null && (
          <span style={{ fontSize: 9.5, fontFamily: MONO, color: 'rgba(255,255,255,0.35)' }}>
            {item.downloads} installs
          </span>
        )}
      </div>
    </div>
  );
}
