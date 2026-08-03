import type { CatalogItem } from '../state/catalog';
import { rowPlanFor, type RowAction } from '../state/libraryRows';
import { previewSourceFor } from '../components/previewSource';
import { PreviewImage } from '../components/PreviewImage';
import { catalogCardTags } from '../state/catalogTags';
import { cfgUrl } from '../state/marketplaceConfig';

const MONO = '"JetBrains Mono", ui-monospace, monospace';

const ACTION_LABEL: Record<RowAction, string> = {
  add: '+ Add', setup: 'Set up', update: 'Update',
  remove: 'Remove', hide: 'Hide', restore: 'Restore',
};

/** One installed item, as a compact row.
 *
 *  A row, not a card: management is a list job — you are scanning names and
 *  states, not being sold anything. The Store is where cards belong.
 *
 *  Which actions appear, and whether the destructive one says Remove or
 *  Hide, is `rowPlanFor`'s decision (state/libraryRows.ts) — a pure function
 *  with a real test, because "Remove" on a compiled-in tile was a lie. */
export function LibraryRow({
  item, plan, accent, glyph: tileGlyph, busy, disabled, onAction,
}: {
  item: CatalogItem;
  /** From `rowPlanFor`. Passed in rather than computed here so this component
   *  stays presentational and the decision keeps its own test. */
  plan: ReturnType<typeof rowPlanFor>;
  accent: string;
  glyph: string | null;
  /** This row's own mutation is in flight — drives the '…' label. */
  busy: boolean;
  /** Any mutation anywhere is in flight. See useContentMutations' anyBusy:
   *  handlers compute their next tombstone list from state captured at click
   *  time, so concurrent mutations would revert each other. */
  disabled: boolean;
  onAction: (a: RowAction) => void;
}) {
  const tags = catalogCardTags(item);
  const version = item.installed ? item.installedVersion : item.availableVersion;
  const letter = item.name.trim().charAt(0).toUpperCase() || '?';
  const glyph = item.icon ?? tileGlyph ?? letter;
  const previewSrc = previewSourceFor(item, tileGlyph);
  const thumb = previewSrc.kind === 'image' && item.availableVersion != null ? (
    <PreviewImage
      id={item.id}
      version={item.availableVersion}
      kind={item.kind}
      url={cfgUrl()}
      fallback={<span style={{ fontSize: 13, fontWeight: 700, color: `${accent}cc` }}>{glyph}</span>}
    />
  ) : (
    <span style={{ fontSize: 13, fontWeight: 700, color: `${accent}cc` }}>{glyph}</span>
  );

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 6,
      padding: '8px 10px', borderRadius: 8, marginBottom: 6,
      background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <div style={{
          width: 30, height: 30, borderRadius: 6, flexShrink: 0, overflow: 'hidden',
          background: `linear-gradient(135deg, ${accent}22, ${accent}08)`,
          border: `1px solid ${accent}2a`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{thumb}</div>

        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
            <span style={{
              fontSize: 12.5, fontWeight: 600, color: 'rgba(255,255,255,0.9)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{item.name}</span>
            {tags.map((t) => (
              <span key={t.text} style={{
                fontSize: 8.5, fontFamily: MONO, fontWeight: 700, letterSpacing: '0.05em',
                padding: '2px 5px', borderRadius: 4, flexShrink: 0,
                color: t.color, background: t.bg, textTransform: 'uppercase',
              }}>{t.text}</span>
            ))}
          </div>
          <div style={{ fontSize: 10, fontFamily: MONO, color: 'rgba(255,255,255,0.38)' }}>
            {item.kind} · v{version ?? '—'}
            {item.updateAvailable && item.availableVersion ? ` → v${item.availableVersion}` : ''}
            {plan.incompatibleNote ? ` · ${plan.incompatibleNote}` : ''}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {plan.actions.map((a) => (
            <button
              key={a}
              onClick={() => onAction(a)}
              disabled={disabled}
              style={{
                padding: '3px 10px', fontSize: 10, fontWeight: 600, borderRadius: 5,
                background: a === 'remove' || a === 'hide' ? 'rgba(255,255,255,0.04)' : `${accent}22`,
                color: a === 'remove' || a === 'hide' ? 'rgba(255,255,255,0.65)' : accent,
                border: a === 'remove' || a === 'hide'
                  ? '1px solid rgba(255,255,255,0.12)' : `1px solid ${accent}44`,
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.55 : 1,
              }}
            >{busy ? '…' : a === 'remove' || a === 'hide' ? plan.removeLabel : ACTION_LABEL[a]}</button>
          ))}
        </div>
      </div>

      {/* A bare version bump is not persuasive — the changelog is what makes
          carrying it worthwhile, so it renders inline under an available
          update rather than hiding behind a click. */}
      {item.updateAvailable && item.changelog && (
        <div style={{
          fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: 1.4,
          paddingLeft: 40, whiteSpace: 'pre-wrap',
        }}>{item.changelog}</div>
      )}
    </div>
  );
}
