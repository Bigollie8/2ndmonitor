import { useEffect, useMemo, useState } from 'react';
import { mergeCatalog, type CatalogItem, type IndexBundle } from '../state/catalog';
import { TILE_META } from '../state/tileMeta';
import { BUILTIN_VIZ_STYLES } from './viz-styles';
import type { InstalledTileFolder } from '../tiles/tileRegistry';
import type { InstalledVizFolder } from '../state/contentRegistry';
import { buildRail } from './catalogRail';

const MONO = '"JetBrains Mono", ui-monospace, monospace';

// Same marketplace server config MarketplaceTab.tsx reads — mirrored here
// rather than imported so this task doesn't touch that file. Task 11 moves
// this config to Settings; until then both surfaces read the same
// localStorage keys and defaults.
const LS_URL = 'marketplace.url';
const LS_PUBKEY = 'marketplace.pubkey';
const DEFAULT_URL = 'https://market.basedsecurity.net';
const DEFAULT_PUBKEY = '35a3b117c5e6ed793b5b78640db3075c48feb0d943541d86f3b462c9bed8d816';
const cfgUrl = () => localStorage.getItem(LS_URL) || DEFAULT_URL;
const cfgPubkey = () => localStorage.getItem(LS_PUBKEY) || DEFAULT_PUBKEY;

/** The unified content catalog shell: a fixed-width category rail with live
 *  counts (from `buildRail`, a pure function — see catalogRail.ts) and a
 *  right pane. Cards, install/remove actions, search and error states are
 *  later tasks (9, 9, 10) — for now the right pane only renders the filtered
 *  item count. Same modal-frame visual language as TileLibrary: dark
 *  translucent panel, hairline borders, JetBrains Mono metadata, accent
 *  passed in as a prop. */
export function ContentLibrary({
  accent, catalogRemoved, onClose,
}: {
  accent: string;
  /** The catalog removal list — see state/removedContent.ts. */
  catalogRemoved: string[];
  onClose: () => void;
}) {
  const [installedTiles, setInstalledTiles] = useState<InstalledTileFolder[]>([]);
  const [installedViz, setInstalledViz] = useState<InstalledVizFolder[]>([]);
  const [index, setIndex] = useState<IndexBundle[]>([]);
  const [activeId, setActiveId] = useState('all');

  // tiles_list / visualizers_list are independent commands: allSettled so a
  // failing one doesn't blank the other's already-fetched results (same
  // pattern as MarketplaceTab's refreshInstalled). The marketplace index is
  // fetched separately and fails soft to `[]` — an unreachable server still
  // renders the catalog from the compile-time tables plus installed folders.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      const [tiles, viz] = await Promise.allSettled([
        invoke<InstalledTileFolder[]>('tiles_list'),
        invoke<InstalledVizFolder[]>('visualizers_list'),
      ]);
      if (cancelled) return;
      if (tiles.status === 'fulfilled') setInstalledTiles(tiles.value);
      if (viz.status === 'fulfilled') setInstalledViz(viz.value);

      try {
        const idx = await invoke<{ bundles: IndexBundle[] }>('marketplace_fetch_index', {
          url: cfgUrl(), pubkey: cfgPubkey(),
        });
        if (!cancelled) setIndex(idx.bundles ?? []);
      } catch { /* fail soft — Task 10 adds an inline notice + retry */ }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  const items = useMemo<CatalogItem[]>(() => mergeCatalog({
    tileMeta: TILE_META,
    vizStyles: BUILTIN_VIZ_STYLES,
    installedTiles,
    installedViz,
    index,
    removed: catalogRemoved,
    needsSetup: [], // Task 9 wires the real credential-state list.
  }), [installedTiles, installedViz, index, catalogRemoved]);

  const rail = useMemo(() => buildRail(items), [items]);
  // rail[0] is always the 'all' row (buildRail always pushes it) — a safe
  // fallback if the active row's count dropped to zero and it disappeared.
  const active = rail.find((r) => r.id === activeId && !r.heading) ?? rail[0];
  const filtered = useMemo(() => items.filter(active.match), [items, active]);

  // Esc closes the modal (capture + stopPropagation so App's cascade doesn't
  // also fire) — same convention as TileLibrary.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute', inset: 0, zIndex: 70,
        background: 'rgba(8,9,12,0.55)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(920px, 92%)', maxHeight: '82%',
          background: 'rgba(20,22,28,0.98)', backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 12, boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '12px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        }}>
          <div style={{ width: 8, height: 8, background: accent, borderRadius: 2 }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>Content Library</span>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontFamily: MONO }}>
            · {items.length} total
          </span>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} title="Close (Esc)" style={{
            padding: '4px 10px', fontSize: 12,
            background: 'transparent', color: 'rgba(255,255,255,0.55)',
            border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5, cursor: 'pointer',
          }}>×</button>
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* Category rail — fixed 104px, live counts from buildRail. */}
          <div style={{
            width: 104, flexShrink: 0, overflowY: 'auto',
            borderRight: '1px solid rgba(255,255,255,0.06)',
            padding: '8px 6px', display: 'flex', flexDirection: 'column', gap: 2,
          }}>
            {rail.map((row) =>
              row.heading ? (
                <div key={row.id} style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                  color: 'rgba(255,255,255,0.35)', padding: '10px 6px 4px',
                }}>{row.label}</div>
              ) : (
                <button
                  key={row.id}
                  onClick={() => setActiveId(row.id)}
                  title={`${row.label} · ${row.count}`}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4,
                    width: '100%', padding: '5px 6px', fontSize: 10.5, borderRadius: 5, textAlign: 'left',
                    background: row.id === active.id ? `${accent}18` : 'transparent',
                    color: row.id === active.id ? accent : 'rgba(255,255,255,0.6)',
                    fontWeight: row.id === active.id ? 600 : 400,
                    border: 'none', cursor: 'pointer',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.label}
                  </span>
                  <span style={{
                    fontSize: 9, fontFamily: MONO, flexShrink: 0,
                    color: row.id === active.id ? `${accent}cc` : 'rgba(255,255,255,0.35)',
                  }}>{row.count}</span>
                </button>
              ),
            )}
          </div>

          {/* Right pane — cards + install/remove actions land here in Task 9.
              For now it renders only the filtered item count. */}
          <div style={{ flex: 1, padding: 18, overflow: 'auto' }}>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)' }}>
              {filtered.length} {filtered.length === 1 ? 'item' : 'items'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
