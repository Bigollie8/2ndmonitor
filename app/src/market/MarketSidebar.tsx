import type { RailSection } from '../components/catalogRail';
import type { Facets } from '../state/catalogFilter';

const MONO = '"JetBrains Mono", ui-monospace, monospace';

/** Facet equality by value. Object identity is useless here: `buildRail`
 *  returns fresh objects on every catalog change, so an identity check would
 *  clear the selection highlight every time a count updated. */
export const facetKey = (f: Facets): string => JSON.stringify({
  kind: f.kind ?? null, category: f.category ?? null, tags: [...f.tags].sort(),
  installed: !!f.installed, updates: !!f.updates, needsSetup: !!f.needsSetup,
  hasPreview: !!f.hasPreview, noPermissions: !!f.noPermissions,
  removed: !!f.removed, incompatible: !!f.incompatible,
});

/** The store's left rail: `buildRail`'s rows, now selecting FACETS rather
 *  than swapping a predicate. Rendered only in the `wide` layout — below
 *  1100px MarketView renders `MarketKindStrip` instead, because 180px of rail
 *  on a 1080-wide portrait panel costs more than it gives. */
export function MarketSidebar({ accent, rows, activeFacets, width, onPick }: {
  accent: string;
  rows: RailSection[];
  activeFacets: Facets;
  width: number;
  onPick: (f: Facets) => void;
}) {
  const activeKey = facetKey(activeFacets);
  return (
    <div style={{
      width, flexShrink: 0, overflowY: 'auto', padding: '10px 8px',
      borderRight: '1px solid rgba(255,255,255,0.06)',
    }}>
      {rows.map((r) => {
        if (r.heading) {
          return (
            <div key={r.id} style={{
              fontSize: 9, fontFamily: MONO, fontWeight: 700, letterSpacing: '0.12em',
              color: 'rgba(255,255,255,0.28)', textTransform: 'uppercase',
              padding: '12px 8px 4px',
            }}>{r.label}</div>
          );
        }
        const on = facetKey(r.facets) === activeKey;
        return (
          <button
            key={r.id}
            onClick={() => onPick(r.facets)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, width: '100%',
              padding: '5px 8px', marginBottom: 1, borderRadius: 6,
              background: on ? `${accent}1f` : 'transparent',
              color: on ? accent : 'rgba(255,255,255,0.6)',
              border: 'none', cursor: 'pointer', textAlign: 'left',
              fontSize: 11.5, fontWeight: on ? 600 : 500,
            }}
          >
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.label}
            </span>
            <span style={{ fontSize: 9.5, fontFamily: MONO, opacity: 0.55 }}>{r.count}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The sidebar's replacement below 1100px: kind rows only, laid out
 *  horizontally above the grid. The category breakdown is reachable through
 *  the sidebar in `wide` and through search/chips everywhere else — it is the
 *  part worth dropping when there is no room for a rail. */
export function MarketKindStrip({ accent, rows, activeFacets, onPick }: {
  accent: string;
  rows: RailSection[];
  activeFacets: Facets;
  onPick: (f: Facets) => void;
}) {
  const activeKey = facetKey(activeFacets);
  const picked = rows.filter((r) => !r.heading && !r.id.includes(':'));
  return (
    <div style={{
      display: 'flex', gap: 6, flexWrap: 'wrap', padding: '10px 18px 0',
    }}>
      {picked.map((r) => {
        const on = facetKey(r.facets) === activeKey;
        return (
          <button
            key={r.id}
            onClick={() => onPick(r.facets)}
            style={{
              padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600,
              background: on ? `${accent}1f` : 'rgba(255,255,255,0.04)',
              color: on ? accent : 'rgba(255,255,255,0.6)',
              border: on ? `1px solid ${accent}44` : '1px solid rgba(255,255,255,0.08)',
              cursor: 'pointer',
            }}
          >{r.label} <span style={{ fontFamily: MONO, fontSize: 9.5, opacity: 0.6 }}>{r.count}</span></button>
        );
      })}
    </div>
  );
}
