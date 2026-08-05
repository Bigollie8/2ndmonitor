import { useCallback, useMemo, useState } from 'react';
import type { CatalogItem } from '../state/catalog';
import type { TileType } from '../state/layout';
import { TILE_META } from '../state/tileMeta';
import { tileInstanceType } from '../state/catalog';
import { useCatalogData } from '../state/useCatalogData';
import { filterItems } from '../state/catalogFilter';
import { searchItems } from '../components/catalogSearch';
import { rowPlanFor, sectionFacets, type LibrarySection, type RowAction } from '../state/libraryRows';
import { parsePermission } from '../sandbox/manifest';
import { getSecret, bundleSecretKey } from '../state/secrets';
import { TileCredentialPanel } from '../components/TileCredentialPanel';
import { useContentMutations } from './useContentMutations';
import { LibraryRow } from './LibraryRow';

const MONO = '"JetBrains Mono", ui-monospace, monospace';

/** Content kinds the library can filter by. 'all' is not a CatalogItem.kind —
 *  it is the no-filter sentinel. */
type CatalogKind = 'all' | 'visualizer' | 'tile' | 'preset';

const KIND_FILTERS: { id: CatalogKind; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'visualizer', label: 'Visualizers' },
  { id: 'tile', label: 'Tiles' },
  { id: 'preset', label: 'Presets' },
];

const SECTIONS: { id: LibrarySection; label: string }[] = [
  { id: 'installed', label: 'Installed' },
  { id: 'updates', label: 'Updates' },
  { id: 'needs-setup', label: 'Needs setup' },
  { id: 'removed', label: 'Removed' },
];

/** Managing what you already have: Installed, Updates, Needs setup, Removed.
 *
 *  Split out of the old 864-line ContentLibrary, which did this job AND
 *  browsing the marketplace and had to carry an information architecture that
 *  served both. Discovery lives in the Store now; this surface only manages. */
export function LibraryView({
  accent, catalogRemoved, setCatalogRemoved,
  onRemoveTileInstances, onAddTileInstance, onVisualizerRemoved, onClose, initialSection,
}: {
  accent: string;
  catalogRemoved: string[];
  setCatalogRemoved: (next: string[]) => void;
  onRemoveTileInstances: (type: TileType) => void;
  onAddTileInstance: (type: TileType) => void;
  onVisualizerRemoved: (key: string) => void;
  onClose: () => void;
  initialSection?: LibrarySection;
}) {
  const data = useCatalogData({ catalogRemoved });
  const mutations = useContentMutations({
    catalogRemoved, setCatalogRemoved,
    refreshInstalled: data.refreshInstalled,
    onRemoveTileInstances, onVisualizerRemoved,
  });
  const [section, setSection] = useState<LibrarySection>(initialSection ?? 'installed');
  const [updatingAll, setUpdatingAll] = useState(false);
  const [setupFor, setSetupFor] = useState<CatalogItem | null>(null);
  const [storedSecretKeys, setStoredSecretKeys] = useState<string[]>([]);

  const counts = useMemo(() => {
    const out: Record<LibrarySection, number> = {
      installed: 0, updates: 0, 'needs-setup': 0, removed: 0,
    };
    for (const s of SECTIONS) {
      out[s.id] = filterItems(data.items, sectionFacets(s.id), data.appVersion).length;
    }
    return out;
  }, [data.items, data.appVersion]);

  // Search + kind filter over what you already OWN (0.8.3).
  //
  // The 864-line ContentLibrary split put search on the Store side on the
  // grounds that it is "discovery". That holds for finding something new and
  // breaks down for management: once you have dozens of installed items,
  // finding one you already own is the common case, and the sections alone
  // (Installed / Updates / Needs setup / Removed) do not narrow it. Reuses the
  // same scored search and the same kind facets the Store uses, so ranking is
  // identical in both places.
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<CatalogKind>('all');

  const rows = useMemo(() => {
    const inSection = filterItems(data.items, sectionFacets(section), data.appVersion);
    const byKind = kind === 'all' ? inSection : inSection.filter((i) => i.kind === kind);
    return query.trim() === '' ? byKind : searchItems(byKind, query);
  }, [data.items, section, data.appVersion, kind, query]);

  /** Kind counts for the current section, so a filter that would show nothing
   *  is visibly empty rather than silently missing. */
  const kindCounts = useMemo(() => {
    const inSection = filterItems(data.items, sectionFacets(section), data.appVersion);
    const out: Record<CatalogKind, number> = { all: inSection.length, visualizer: 0, tile: 0, preset: 0 };
    for (const i of inSection) {
      if (i.kind === 'visualizer' || i.kind === 'tile' || i.kind === 'preset') out[i.kind] += 1;
    }
    return out;
  }, [data.items, section, data.appVersion]);

  const glyphOf = useCallback((item: CatalogItem): string | null => (
    item.kind === 'tile' && Object.prototype.hasOwnProperty.call(TILE_META, item.id)
      ? TILE_META[item.id as keyof typeof TILE_META].icon
      : null
  ), []);

  const openSetup = useCallback(async (item: CatalogItem) => {
    const declared = item.permissions
      .map((p) => parsePermission(p))
      .flatMap((r) => (r.ok && r.perm.kind === 'secret' ? [r.perm.key] : []));
    const stored = await Promise.all(
      declared.map(async (k) => ((await getSecret(bundleSecretKey(item.id, k))) != null ? k : null)),
    );
    setStoredSecretKeys(stored.filter((k): k is string => k != null));
    setSetupFor(item);
  }, []);

  const handleAction = useCallback((item: CatalogItem, action: RowAction) => {
    switch (action) {
      case 'add': {
        const type = tileInstanceType(item);
        if (type != null) onAddTileInstance(type);
        return;
      }
      case 'setup':
        void openSetup(item);
        return;
      case 'update': {
        const bundle = data.indexByKey.get(item.key);
        if (!bundle) { mutations.flash('Not available from the marketplace right now.'); return; }
        void mutations.install(item, bundle);
        return;
      }
      case 'remove':
      case 'hide':
        void mutations.remove(item);
        return;
      case 'restore':
        void mutations.restore(item);
    }
  }, [data.indexByKey, mutations, onAddTileInstance, openSetup]);

  // Sequentially, NOT concurrently: the busy lock exists to serialize
  // tombstone writes (each handler computes its next list from state captured
  // at call time), and firing installs in parallel would defeat it.
  const updateAll = useCallback(async () => {
    setUpdatingAll(true);
    try {
      for (const item of filterItems(data.items, sectionFacets('updates'), data.appVersion)) {
        const bundle = data.indexByKey.get(item.key);
        if (bundle) await mutations.install(item, bundle);
      }
    } finally {
      setUpdatingAll(false);
    }
  }, [data.items, data.appVersion, data.indexByKey, mutations]);

  const setupSecrets = setupFor
    ? setupFor.permissions
      .map((p) => parsePermission(p))
      .flatMap((r) => (r.ok && r.perm.kind === 'secret'
        ? [{ key: r.perm.key, label: r.perm.key, kind: 'password' as const }]
        : []))
    : [];

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 60,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.5)',
    }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(760px, 92vw)', maxHeight: '86vh',
          display: 'flex', flexDirection: 'column', borderRadius: 14,
          background: 'rgba(16,17,22,0.97)', border: '1px solid rgba(255,255,255,0.1)',
          backdropFilter: 'blur(18px)', overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>Library</span>
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            aria-label="Close the library"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'rgba(255,255,255,0.5)', fontSize: 18, lineHeight: 1, padding: '0 4px',
            }}
          >×</button>
        </div>

        <div style={{ display: 'flex', gap: 6, padding: '10px 18px 0', flexWrap: 'wrap' }}>
          {SECTIONS.map((s) => {
            const on = s.id === section;
            return (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                style={{
                  padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600,
                  background: on ? `${accent}1f` : 'rgba(255,255,255,0.04)',
                  color: on ? accent : 'rgba(255,255,255,0.6)',
                  border: on ? `1px solid ${accent}44` : '1px solid rgba(255,255,255,0.08)',
                  cursor: 'pointer',
                }}
              >{s.label} <span style={{ fontFamily: MONO, fontSize: 9.5, opacity: 0.6 }}>{counts[s.id]}</span></button>
            );
          })}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 18px 18px' }}>
          {section === 'removed' && counts.removed > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 12px', marginBottom: 12, borderRadius: 8,
              background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.09)',
            }}>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', flex: 1 }}>
                {catalogRemoved.length} removed from the catalog — restore one at a time below, or bring everything back at once.
              </span>
              <button
                onClick={() => void mutations.restoreAllDefaults()}
                disabled={mutations.anyBusy}
                style={{
                  padding: '3px 10px', fontSize: 10.5, fontWeight: 600, borderRadius: 5,
                  background: 'transparent', color: 'rgba(255,255,255,0.7)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  cursor: mutations.anyBusy ? 'not-allowed' : 'pointer',
                  opacity: mutations.anyBusy ? 0.55 : 1,
                }}
              >{mutations.restoring ? 'Restoring…' : 'Restore all defaults'}</button>
            </div>
          )}

          {section === 'updates' && counts.updates > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 12px', marginBottom: 12, borderRadius: 8,
              background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.09)',
            }}>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', flex: 1 }}>
                {counts.updates} update{counts.updates === 1 ? '' : 's'} available.
              </span>
              <button
                onClick={() => void updateAll()}
                disabled={mutations.anyBusy || updatingAll}
                style={{
                  padding: '3px 10px', fontSize: 10.5, fontWeight: 600, borderRadius: 5,
                  background: `${accent}22`, color: accent, border: `1px solid ${accent}44`,
                  cursor: mutations.anyBusy || updatingAll ? 'not-allowed' : 'pointer',
                  opacity: mutations.anyBusy || updatingAll ? 0.55 : 1,
                }}
              >{updatingAll ? 'Updating…' : 'Update all'}</button>
            </div>
          )}

          {/* Needs-setup detection requires a live-or-cached index AND
              source === 'marketplace' (deferred finding #78). Phase 2's index
              cache makes it work offline for anything previously seen; a
              never-seen bundle still cannot be classified, so this section can
              under-report. It never over-reports. */}
          {section === 'needs-setup' && (
            <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.35)', marginBottom: 10 }}>
              Only bundles the marketplace index describes can be classified here.
            </div>
          )}

          {/* Find-what-you-own controls (0.8.3). */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            flexWrap: 'wrap', marginBottom: 12,
          }}>
            <div style={{ position: 'relative' }}>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search installed"
                aria-label="Search installed content"
                style={{
                  width: 200, maxWidth: '100%',
                  padding: '5px 10px', paddingRight: query ? 24 : 10,
                  fontSize: 11, fontFamily: MONO, borderRadius: 6,
                  background: 'rgba(255,255,255,0.05)', color: '#fff',
                  border: '1px solid rgba(255,255,255,0.12)', outline: 'none',
                }}
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  style={{
                    position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    color: 'rgba(255,255,255,0.45)', fontSize: 13, lineHeight: 1, padding: '0 4px',
                  }}
                >×</button>
              )}
            </div>
            {KIND_FILTERS.map((k) => {
              const on = kind === k.id;
              const n = kindCounts[k.id];
              return (
                <button
                  key={k.id}
                  onClick={() => setKind(k.id)}
                  aria-pressed={on}
                  style={{
                    padding: '4px 10px', fontSize: 10.5, fontWeight: on ? 700 : 500,
                    fontFamily: MONO, borderRadius: 999, cursor: 'pointer',
                    background: on ? `${accent}22` : 'transparent',
                    color: on ? accent : 'rgba(255,255,255,0.55)',
                    border: `1px solid ${on ? `${accent}55` : 'rgba(255,255,255,0.12)'}`,
                  }}
                >{k.label} {n}</button>
              );
            })}
          </div>

          {data.items.length === 0 ? (
            // Defensive fallback, not a reachable state: mergeCatalog keeps
            // every removed item (flagged, not dropped) and always emits the
            // compile-time tables, so `items` is empty only if TILE_META and
            // BUILTIN_VIZ_STYLES were both empty.
            <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', padding: '24px 0' }}>
              The catalog is empty.
            </div>
          ) : rows.length === 0 ? (
            // Distinguish "this section is empty" from "your filters hid
            // everything" — otherwise a stale search box reads as data loss.
            <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', padding: '24px 0' }}>
              {query.trim() !== '' || kind !== 'all' ? (
                <>
                  No matches{query.trim() !== '' ? ` for “${query.trim()}”` : ''}
                  {kind !== 'all' ? ` in ${KIND_FILTERS.find((k) => k.id === kind)?.label.toLowerCase()}` : ''}.
                  {' '}
                  <button
                    onClick={() => { setQuery(''); setKind('all'); }}
                    style={{
                      background: 'transparent', border: 'none', padding: 0,
                      color: accent, cursor: 'pointer', fontSize: 11.5,
                    }}
                  >Clear filters</button>
                </>
              ) : 'Nothing here.'}
            </div>
          ) : rows.map((item) => (
            <LibraryRow
              key={item.key}
              item={item}
              plan={rowPlanFor(item, data.appVersion)}
              accent={accent}
              glyph={glyphOf(item)}
              busy={mutations.busyKeys.has(item.key)}
              disabled={mutations.anyBusy}
              onAction={(a) => handleAction(item, a)}
            />
          ))}
        </div>

        {mutations.notice && (
          <div style={{
            padding: '8px 18px', fontSize: 11.5, color: 'rgba(255,255,255,0.8)',
            borderTop: '1px solid rgba(255,255,255,0.06)',
          }}>{mutations.notice}</div>
        )}
      </div>

      {/* The existing credential surface, unchanged. Config is per PLACED
          INSTANCE (see state/catalog.ts) so this catalog-level use passes an
          empty config list — secrets are namespaced per bundle and are
          exactly what `needsSetup` measures. */}
      {setupFor && (
        <div
          onClick={(e) => { e.stopPropagation(); setSetupFor(null); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 70,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.55)',
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{
            width: 'min(420px, 92vw)', padding: 18, borderRadius: 12,
            background: 'rgba(18,20,26,0.98)', border: '1px solid rgba(255,255,255,0.1)',
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.92)', marginBottom: 10 }}>
              {setupFor.name}
            </div>
            <TileCredentialPanel
              bundleId={setupFor.id}
              accent={accent}
              secrets={setupSecrets}
              config={[]}
              storedSecretKeys={storedSecretKeys}
              initialConfig={{}}
              onSaveConfig={() => {}}
              onSecretsSaved={() => {
                setSetupFor(null);
                void data.refreshInstalled();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
