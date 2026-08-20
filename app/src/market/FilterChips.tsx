import type { Facets } from '../state/catalogFilter';

const MONO = '"JetBrains Mono", ui-monospace, monospace';

/** One chip per active facet, each clearable on its own, plus "Clear all".
 *
 *  This is the visible payoff of Phase 2's combinable facets: the user can
 *  see they have `installed` + `weather` + `rain` on at once, a combination
 *  the old rail could not even represent, let alone display. */
export function FilterChips({ accent, facets, onRemove, onClear }: {
  accent: string;
  facets: Facets;
  /** Patch applied to the current facets to drop one — e.g. `{kind: undefined}`. */
  onRemove: (patch: Partial<Facets>) => void;
  onClear: () => void;
}) {
  const chips: { key: string; label: string; clear: Partial<Facets> }[] = [];
  if (facets.kind) chips.push({ key: 'kind', label: facets.kind, clear: { kind: undefined } });
  if (facets.category) chips.push({ key: 'category', label: facets.category, clear: { category: undefined } });
  for (const t of facets.tags) {
    chips.push({ key: `tag:${t}`, label: `#${t}`, clear: { tags: facets.tags.filter((x) => x !== t) } });
  }
  if (facets.installed) chips.push({ key: 'installed', label: 'installed', clear: { installed: undefined } });
  if (facets.updates) chips.push({ key: 'updates', label: 'updates', clear: { updates: undefined } });
  if (facets.needsSetup) chips.push({ key: 'needsSetup', label: 'needs setup', clear: { needsSetup: undefined } });
  if (facets.hasPreview) chips.push({ key: 'hasPreview', label: 'has preview', clear: { hasPreview: undefined } });
  if (facets.noPermissions) chips.push({ key: 'noPermissions', label: 'no network', clear: { noPermissions: undefined } });
  if (facets.removed) chips.push({ key: 'removed', label: 'removed', clear: { removed: undefined } });
  if (facets.incompatible) chips.push({ key: 'incompatible', label: 'incompatible', clear: { incompatible: undefined } });

  if (chips.length === 0) return null;

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
      {chips.map((c) => (
        <span key={c.key} style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '3px 6px 3px 9px', borderRadius: 999,
          fontSize: 10.5, fontFamily: MONO,
          background: `${accent}18`, color: accent, border: `1px solid ${accent}33`,
        }}>
          {c.label}
          <button
            onClick={() => onRemove(c.clear)}
            aria-label={`Remove filter ${c.label}`}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'inherit', fontSize: 12, lineHeight: 1, padding: '0 2px', opacity: 0.75,
            }}
          >×</button>
        </span>
      ))}
      <button
        onClick={onClear}
        style={{
          padding: '3px 9px', borderRadius: 999, fontSize: 10.5, fontFamily: MONO,
          background: 'transparent', color: 'rgba(255,255,255,0.5)',
          border: '1px solid rgba(255,255,255,0.12)', cursor: 'pointer',
        }}
      >Clear all</button>
    </div>
  );
}
