import type { MutableRefObject } from 'react';
import type { CatalogItem } from '../state/catalog';
import type { SpectrumState } from '../state/tauri';
import { previewSourceFor } from './previewSource';
import { PreviewImage } from './PreviewImage';
import { LivePreview } from './LivePreview';
import { StarRating } from './StarRating';
import { cfgUrl } from '../state/marketplaceConfig';

const MONO = '"JetBrains Mono", ui-monospace, monospace';

export interface CatalogTag {
  text: string;
  color: string;
  bg: string;
}

/** Priority-ordered state-tag rule for a catalog card. At most two shown —
 *  see task-9 brief's table. Pure so it's node-testable without rendering;
 *  keep new conditions here rather than inline in `CatalogCard`'s JSX. */
export function catalogCardTags(item: CatalogItem): CatalogTag[] {
  const tags: CatalogTag[] = [];
  if (item.removed) {
    // Outranks everything else: a removed item's card only offers Restore,
    // so every other tag (core, update, needs key…) would be describing a
    // state the card isn't currently acting on.
    tags.push({ text: 'removed', color: 'rgba(255,255,255,0.55)', bg: 'rgba(255,255,255,0.06)' });
    return tags;
  }
  if (item.brokenReason != null) {
    tags.push({ text: 'error', color: '#ff9b9b', bg: 'rgba(255,90,90,0.14)' });
  }
  if (item.updateAvailable) {
    tags.push({ text: 'update', color: '#7cf5d4', bg: 'rgba(124,245,212,0.12)' });
  }
  if (item.installed && item.needsSetup) {
    tags.push({ text: 'needs key', color: '#fbbf24', bg: 'rgba(245,158,11,0.12)' });
  }
  if (item.source === 'first-party') {
    tags.push({ text: 'core', color: 'rgba(255,255,255,0.55)', bg: 'rgba(255,255,255,0.06)' });
  }
  if (!item.installed && item.downloads === 0) {
    tags.push({ text: 'new', color: '#a5b4fc', bg: 'rgba(129,140,248,0.12)' });
  }
  return tags.slice(0, 2);
}

/** One `CatalogItem` in the unified catalog grid. Presentational only — all
 *  data loading and the install/remove mutations live in ContentLibrary.tsx,
 *  which owns `busy` (disables the action button mid-mutation) and the two
 *  callbacks. Preview area renders one of `previewSource.ts`'s four
 *  treatments (spec C §6): a published image (`PreviewImage`, task 6), a
 *  first-party tile's geometric glyph large and centered, a live sandboxed
 *  render (`LivePreview`, task 7 — itself falls back to the glyph/letter
 *  block below when off-screen, budget-exhausted, or errored), or that same
 *  letter block for anything with nothing else to show. Visual language
 *  matches TileLibrary's TileCard: dark translucent panel, hairline border,
 *  JetBrains Mono metadata. */
export function CatalogCard({
  item, accent, accent2, spectrumRef, glyph: tileGlyph, busy, disabled, onInstall, onRemove, onAdd, onRestore,
  signedIn, ratingBusy, onRate,
}: {
  item: CatalogItem;
  accent: string;
  /** Second theme color for a `live` card's sandboxed render — same value the
   *  hero surface passes its own `SandboxVizSurface`. Only consumed by the
   *  `live` branch; every other branch stays single-accent, unchanged. */
  accent2: string;
  /** Live audio-spectrum ref, threaded down for the `live` branch's
   *  `LivePreview` — same ref App.tsx's `useSpectrumRef()` hands the hero
   *  surface. `undefined` (e.g. before ContentLibrary wires it up) just means
   *  a `live` card's sandbox falls back to its own synthetic envelope,
   *  same as the hero surface does with no live audio. */
  spectrumRef?: MutableRefObject<SpectrumState>;
  /** The item's geometric glyph — `TILE_META[id].icon` for a built-in tile,
   *  `null` for everything else (a visualizer style has no glyph table, and a
   *  marketplace-only tile has no compile-time entry to hold one). Passed in
   *  rather than imported here so this stays presentational; ContentLibrary
   *  owns the TILE_META lookup. */
  glyph: string | null;
  /** This card's own mutation is in flight — drives the '…' label. */
  busy: boolean;
  /** Some mutation (on any card) is in flight — locks every action button so
   *  a second click can't race the first's write. See ContentLibrary.tsx's
   *  handleInstall/handleRemove: both compute their next list from state
   *  captured at click time, so two overlapping writes can silently revert
   *  each other if only the clicked card were disabled. */
  disabled: boolean;
  onInstall: () => void;
  onRemove: () => void;
  /** Places this tile on the dashboard. Passed (and rendered) only for an
   *  installed tile — a visualizer has no placement action of its own;
   *  selecting one is what the V-cycle and gallery already do. */
  onAdd?: () => void;
  /** Clears this item's tombstone and re-syncs seeds. Only relevant (and
   *  only rendered) when `item.removed` — the "Removed" rail row is the one
   *  place this card is used for a removed item. See
   *  state/removedContent.ts's `restoreItem`. */
  onRestore?: () => void;
  /** Whether the marketplace session is signed in — passed down rather than
   *  read here so this card stays presentational; ContentLibrary owns
   *  `useMarketplaceAuth()`. Gates `StarRating`'s click-to-rate, per
   *  `ratingDisplay`'s rule (StarRating.tsx). */
  signedIn: boolean;
  /** This card's own rate request is in flight — separate from `busy`
   *  (install/remove), since rating one card shouldn't visually couple to a
   *  install/remove mutation on another. */
  ratingBusy: boolean;
  onRate: (stars: number) => void;
}) {
  const tags = catalogCardTags(item);
  const version = item.installed ? item.installedVersion : item.availableVersion;
  // Deepest fallback — "today's block": the letter this card has always
  // shown when there is nothing better (no TILE_META glyph, no published
  // image, no live render). Kept unchanged so a marketplace item with none
  // of those still gets a legible tile instead of a blank frame.
  const letterFallback = item.name.trim().charAt(0).toUpperCase() || '?';
  // What every non-`image`, non-`live` branch renders, and what both
  // `PreviewImage` and `LivePreview` fall back to when they have nothing to
  // show (fetch never resolved/failed; off-screen, budget-exhausted, or
  // errored). `tileGlyph` is non-null exactly when `previewSourceFor` would
  // pick the `glyph` branch (see its doc comment), so this one node correctly
  // serves `glyph` and `placeholder` directly, and is handed to the other two
  // as their fallback prop.
  const fallbackContent = tileGlyph ? (
    <span style={{ fontSize: 24, fontWeight: 700, color: `${accent}cc` }}>{tileGlyph}</span>
  ) : (
    <span style={{ fontSize: 18, fontWeight: 700, color: `${accent}cc` }}>{letterFallback}</span>
  );
  const previewSrc = previewSourceFor(item, tileGlyph);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 8,
      padding: 10, borderRadius: 10,
      background: item.installed ? `${accent}08` : 'rgba(255,255,255,0.03)',
      border: item.installed ? `1px solid ${accent}33` : '1px solid rgba(255,255,255,0.07)',
      minWidth: 0,
    }}>
      {/* 46px preview — a published image (task 6), a live sandboxed render
          (task 7), this item's glyph, or today's letter block. `overflow:
          hidden` clips PreviewImage's <img> and LivePreview's sandbox to the
          frame's rounded corners. */}
      <div style={{
        height: 46, borderRadius: 6, flexShrink: 0, overflow: 'hidden',
        background: `linear-gradient(135deg, ${accent}22, ${accent}08)`,
        border: `1px solid ${accent}2a`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {previewSrc.kind === 'image' && item.availableVersion != null ? (
          <PreviewImage
            id={item.id}
            version={item.availableVersion}
            kind={item.kind}
            url={cfgUrl()}
            fallback={fallbackContent}
          />
        ) : previewSrc.kind === 'live' ? (
          <LivePreview
            bundleId={previewSrc.bundleId}
            accent={accent}
            accent2={accent2}
            spectrumRef={spectrumRef}
            fallback={fallbackContent}
          />
        ) : fallbackContent}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
        <span style={{
          fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.9)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
        }} title={item.name}>{item.name}</span>
        {tags.map((t) => (
          <span key={t.text} style={{
            fontSize: 8.5, fontFamily: MONO, fontWeight: 700, letterSpacing: '0.05em',
            padding: '2px 5px', borderRadius: 4, flexShrink: 0,
            color: t.color, background: t.bg, textTransform: 'uppercase',
          }}>{t.text}</span>
        ))}
      </div>

      <div style={{
        fontSize: 10, fontFamily: MONO, color: 'rgba(255,255,255,0.4)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }} title={item.description}>
        {item.kind} · v{version ?? '—'}{item.description ? ` · ${item.description}` : ''}
      </div>

      <StarRating
        rating={item.rating}
        signedIn={signedIn}
        // A first-party built-in (Mixer, core tiles/visualizers) is never a
        // marketplace bundle — the server 400s "bundle does not exist or is
        // not approved" for any id that isn't one. Without this, a
        // signed-in user clicking its stars saw a flicker of a fake
        // optimistic rating followed by an error flash, every time (D3
        // review, Important 1). See ratingDisplay's doc comment.
        ratable={item.source !== 'first-party'}
        busy={ratingBusy}
        onRate={onRate}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ flex: 1 }} />
        {item.removed ? (
          <button
            onClick={onRestore}
            disabled={disabled}
            title="Restore to the catalog"
            style={{
              padding: '3px 10px', fontSize: 10, fontWeight: 600, borderRadius: 5,
              background: `${accent}22`, color: accent,
              border: `1px solid ${accent}44`,
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.55 : 1,
            }}
          >{busy ? '…' : 'Restore'}</button>
        ) : (
          <>
            {onAdd && (
              <button
                onClick={onAdd}
                disabled={disabled}
                title="Add to dashboard"
                style={{
                  padding: '3px 10px', fontSize: 10, fontWeight: 600, borderRadius: 5,
                  background: 'transparent', color: `${accent}dd`,
                  border: `1px solid ${accent}33`,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  opacity: disabled ? 0.55 : 1,
                }}
              >+ Add</button>
            )}
            <button
              onClick={item.installed ? onRemove : onInstall}
              disabled={disabled}
              style={{
                padding: '3px 10px', fontSize: 10, fontWeight: 600, borderRadius: 5,
                background: item.installed ? 'rgba(255,255,255,0.04)' : `${accent}22`,
                color: item.installed ? 'rgba(255,255,255,0.65)' : accent,
                border: item.installed ? '1px solid rgba(255,255,255,0.12)' : `1px solid ${accent}44`,
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.55 : 1,
              }}
            >{busy ? '…' : item.installed ? 'Remove' : 'Install'}</button>
          </>
        )}
      </div>
    </div>
  );
}
