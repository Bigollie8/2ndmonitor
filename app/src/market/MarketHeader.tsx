import { forwardRef } from 'react';
import type { BrowseState } from '../state/browseState';
import { SORT_LABELS, type SortMode } from '../state/catalogSort';

const MONO = '"JetBrains Mono", ui-monospace, monospace';

/** The store's top strip: back, title, search, sort, close.
 *
 *  Visual conventions copied from ContentLibrary's modal header rather than
 *  invented — dark translucent panel, hairline bottom border, JetBrains Mono
 *  for the count. Two visual systems for the same app is the thing to avoid.
 *
 *  The search input is forwarded so MarketView's `/` shortcut can focus it
 *  without this component owning a keyboard handler of its own. */
export const MarketHeader = forwardRef<HTMLInputElement, {
  accent: string;
  browse: BrowseState;
  canGoBack: boolean;
  totalCount: number;
  onBack: () => void;
  onClose: () => void;
  onQuery: (q: string) => void;
  onSort: (s: SortMode) => void;
}>(function MarketHeader(
  { accent, browse, canGoBack, totalCount, onBack, onClose, onQuery, onSort }, ref,
) {
  const field = {
    padding: '5px 10px', fontSize: 11.5, borderRadius: 6,
    background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.9)',
    border: '1px solid rgba(255,255,255,0.1)', outline: 'none',
  } as const;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 18px', flexShrink: 0,
      borderBottom: '1px solid rgba(255,255,255,0.06)',
    }}>
      <button
        onClick={onBack}
        style={{
          padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6,
          background: 'transparent', color: 'rgba(255,255,255,0.65)',
          border: '1px solid rgba(255,255,255,0.12)', cursor: 'pointer',
        }}
      >{canGoBack ? '‹ Back' : '‹ Dashboard'}</button>

      <span style={{
        fontSize: 11, fontFamily: MONO, fontWeight: 700, letterSpacing: '0.14em',
        color: accent, textTransform: 'uppercase',
      }}>Market</span>

      <span style={{ fontSize: 10, fontFamily: MONO, color: 'rgba(255,255,255,0.35)' }}>
        {totalCount} item{totalCount === 1 ? '' : 's'}
      </span>

      <div style={{ flex: 1 }} />

      {/* Same clear-× affordance the Content Library search has. */}
      <div style={{ position: 'relative' }}>
        <input
          ref={ref}
          value={browse.query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search the market"
          aria-label="Search the market"
          style={{ ...field, width: 220, paddingRight: browse.query ? 24 : 10 }}
        />
        {browse.query && (
          <button
            onClick={() => onQuery('')}
            aria-label="Clear search"
            style={{
              position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'rgba(255,255,255,0.45)', fontSize: 13, lineHeight: 1, padding: '0 4px',
            }}
          >×</button>
        )}
      </div>

      {/* A plain <select>, not a custom popover: a popover would need its own
          outside-click, focus-trap and keyboard handling, all of which
          <select> already has and none of which is this feature's point. */}
      <select
        value={browse.sort}
        onChange={(e) => onSort(e.target.value as SortMode)}
        aria-label="Sort catalog"
        style={{ ...field, cursor: 'pointer' }}
      >
        {(Object.keys(SORT_LABELS) as SortMode[]).map((m) => (
          <option key={m} value={m} style={{ background: '#15161a' }}>{SORT_LABELS[m]}</option>
        ))}
      </select>

      <button
        onClick={onClose}
        aria-label="Close the market"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'rgba(255,255,255,0.5)', fontSize: 18, lineHeight: 1, padding: '0 4px',
        }}
      >×</button>
    </div>
  );
});
