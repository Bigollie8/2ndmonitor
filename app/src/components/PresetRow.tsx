import type { CatalogItem } from '../state/catalog';
import { previewSourceFor } from './previewSource';
import { PreviewImage } from './PreviewImage';
import { cfgUrl } from '../state/marketplaceConfig';

const MONO = '"JetBrains Mono", ui-monospace, monospace';

/** One `CatalogItem` of kind `'preset'`, rendered as a single compact row
 *  rather than CatalogCard's full tile grid card. A MilkDrop preset is data,
 *  not sandboxed code — no rating, no live preview (canLivePreview already
 *  gates on `item.kind === 'visualizer'`, so a preset never qualifies) — and a
 *  marketplace catalog can list hundreds of them, so a one-line row is the
 *  right density where a card grid isn't.
 *
 *  Preview resolution mirrors CatalogCard exactly: `previewSourceFor` picks
 *  the treatment, and an `image` result renders via `PreviewImage` — the same
 *  data-URL fetch through `marketplace_fetch_preview` (kind `'preset'` since
 *  Task 2), never a direct `<img src="https://…">`. A preset has no
 *  compile-time glyph table (unlike a built-in tile), so `previewSourceFor` is
 *  always called with `glyph: null` here — the only two branches that can
 *  ever come back are `image` and `placeholder`, and the placeholder falls
 *  back to the same first-letter block CatalogCard uses.
 *
 *  Install/Remove/Restore state logic matches CatalogCard's button rule:
 *  removed ⇒ Restore only; else installed ⇒ Remove (plus an Update button
 *  when `updateAvailable`, calling the same `onInstall` — a preset install is
 *  always the direct, no-permissions path, so "install" and "update" are the
 *  same call); else ⇒ Install. */
export function PresetRow({
  item, accent, busy, disabled, onInstall, onRemove, onRestore,
}: {
  item: CatalogItem;
  accent: string;
  /** This row's own mutation is in flight — drives the '…' label. */
  busy: boolean;
  /** Some mutation (on any row or card) is in flight — locks every action
   *  button, same reasoning as CatalogCard's `disabled` prop. */
  disabled: boolean;
  onInstall: () => void;
  onRemove: () => void;
  onRestore: () => void;
}) {
  const version = item.installed ? item.installedVersion : item.availableVersion;
  const letterFallback = item.name.trim().charAt(0).toUpperCase() || '?';
  const fallbackContent = (
    <span style={{ fontSize: 12, fontWeight: 700, color: `${accent}cc` }}>{letterFallback}</span>
  );
  const previewSrc = previewSourceFor(item, null);
  const thumb = previewSrc.kind === 'image' && item.availableVersion != null ? (
    <PreviewImage
      id={item.id}
      version={item.availableVersion}
      kind={item.kind}
      url={cfgUrl()}
      fallback={fallbackContent}
    />
  ) : fallbackContent;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '6px 8px', borderRadius: 8,
      background: item.installed ? `${accent}08` : 'rgba(255,255,255,0.03)',
      border: item.installed ? `1px solid ${accent}33` : '1px solid rgba(255,255,255,0.07)',
      minWidth: 0,
    }}>
      {/* 72×24 thumbnail — same frame treatment as CatalogCard's preview, just
          smaller to fit a one-line row. */}
      <div style={{
        width: 72, height: 24, borderRadius: 5, flexShrink: 0, overflow: 'hidden',
        background: `linear-gradient(135deg, ${accent}22, ${accent}08)`,
        border: `1px solid ${accent}2a`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {thumb}
      </div>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{
          fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.9)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }} title={item.name}>{item.name}</span>
        <span style={{
          fontSize: 10, fontFamily: MONO, color: 'rgba(255,255,255,0.4)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }} title={item.description}>{item.description || '—'}</span>
      </div>

      <span style={{ fontSize: 10, fontFamily: MONO, color: 'rgba(255,255,255,0.4)', flexShrink: 0 }}>
        v{version ?? '—'}
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
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
            {item.installed && item.updateAvailable && (
              <button
                onClick={onInstall}
                disabled={disabled}
                title="Update to the latest version"
                style={{
                  padding: '3px 10px', fontSize: 10, fontWeight: 600, borderRadius: 5,
                  background: 'rgba(124,245,212,0.12)', color: '#7cf5d4',
                  border: '1px solid rgba(124,245,212,0.35)',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  opacity: disabled ? 0.55 : 1,
                }}
              >{busy ? '…' : 'Update'}</button>
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
