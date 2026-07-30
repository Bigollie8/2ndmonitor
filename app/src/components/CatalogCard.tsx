import type { CatalogItem } from '../state/catalog';

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
 *  callbacks. Preview area is a placeholder block until spec C adds real
 *  thumbnails. Visual language matches TileLibrary's TileCard: dark
 *  translucent panel, hairline border, JetBrains Mono metadata. */
export function CatalogCard({
  item, accent, busy, disabled, onInstall, onRemove, onAdd, onRestore,
}: {
  item: CatalogItem;
  accent: string;
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
}) {
  const tags = catalogCardTags(item);
  const version = item.installed ? item.installedVersion : item.availableVersion;
  const glyph = item.name.trim().charAt(0).toUpperCase() || '?';

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 8,
      padding: 10, borderRadius: 10,
      background: item.installed ? `${accent}08` : 'rgba(255,255,255,0.03)',
      border: item.installed ? `1px solid ${accent}33` : '1px solid rgba(255,255,255,0.07)',
      minWidth: 0,
    }}>
      {/* 46px preview placeholder — replaced by a real thumbnail in spec C. */}
      <div style={{
        height: 46, borderRadius: 6, flexShrink: 0,
        background: `linear-gradient(135deg, ${accent}22, ${accent}08)`,
        border: `1px solid ${accent}2a`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 18, fontWeight: 700, color: `${accent}cc`,
      }}>{glyph}</div>

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
