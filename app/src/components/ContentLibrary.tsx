import { useCallback, useEffect, useMemo, useState } from 'react';
import { mergeCatalog, catalogKey, type CatalogItem, type IndexBundle } from '../state/catalog';
import { withRemoval, withoutRemoval } from '../state/removedContent';
import { TILE_META } from '../state/tileMeta';
import { BUILTIN_VIZ_STYLES } from './viz-styles';
import type { InstalledTileFolder } from '../tiles/tileRegistry';
import { bundleTileId } from '../tiles/tileRegistry';
import type { InstalledVizFolder } from '../state/contentRegistry';
import type { TileType, BuiltinTileType } from '../state/layout';
import { buildRail } from './catalogRail';
import { CatalogCard } from './CatalogCard';
import { parsePermission } from '../sandbox/manifest';

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

/** Human phrasing for a permission string, shown in the install confirm
 *  dialog. Lifted from MarketplaceTab.tsx unchanged in behavior. */
function describePermission(p: string): string {
  const parsed = parsePermission(p);
  if (!parsed.ok) return p;
  if (parsed.perm.kind === 'net') return `Access the internet at ${parsed.perm.host}`;
  if (parsed.perm.kind === 'secret') return `Store a credential named "${parsed.perm.key}"`;
  return `Run the app command "${parsed.perm.command}"`;
}

/** Is `id` one of the compile-time built-in tile types? Narrows so the
 *  candidate `TileType` for a catalog tile item can be computed without a
 *  cast — a bundle folder's tile always lives at `bundle:<id>` on the canvas
 *  (see tileRegistry.ts), a built-in lives at its bare id. */
function isBuiltinTileId(id: string): id is BuiltinTileType {
  return Object.prototype.hasOwnProperty.call(TILE_META, id);
}

/** The unified content catalog: a fixed-width category rail with live counts
 *  (from `buildRail`, a pure function — see catalogRail.ts) and a card grid
 *  with real install/remove actions for both backings (compile-time
 *  built-ins and marketplace bundles). Same modal-frame visual language as
 *  TileLibrary: dark translucent panel, hairline borders, JetBrains Mono
 *  metadata, accent passed in as a prop. Search and error-state UI (a failed
 *  index fetch fails soft to an empty index today) are Task 10. */
export function ContentLibrary({
  accent, catalogRemoved, setCatalogRemoved, onRemoveTileInstances, onClose,
}: {
  accent: string;
  /** The catalog removal list — see state/removedContent.ts. */
  catalogRemoved: string[];
  /** Writes the next removal list. Backed by `setTweak('catalogRemoved', …)`
   *  in App.tsx — useTweaks is instantiated exactly once there and threaded
   *  down, so this component never calls useTweaks itself. */
  setCatalogRemoved: (next: string[]) => void;
  /** Strips every placed dashboard instance of `type`, across every profile
   *  and orientation. Called on tile removal so a compiled-in tile's fixed
   *  `renderTile` case in App.tsx doesn't keep drawing it — removing it from
   *  the catalog's removed list alone only keeps it out of pickers, not off
   *  an already-placed canvas. */
  onRemoveTileInstances: (type: TileType) => void;
  onClose: () => void;
}) {
  const [installedTiles, setInstalledTiles] = useState<InstalledTileFolder[]>([]);
  const [installedViz, setInstalledViz] = useState<InstalledVizFolder[]>([]);
  const [index, setIndex] = useState<IndexBundle[]>([]);
  const [activeId, setActiveId] = useState('all');
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<{ item: CatalogItem; bundle: IndexBundle } | null>(null);
  const [notice, setNotice] = useState('');

  const setBusy = (key: string, busy: boolean) => {
    setBusyKeys((prev) => {
      const next = new Set(prev);
      if (busy) next.add(key); else next.delete(key);
      return next;
    });
  };

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(''), 3000);
  };

  // Re-runnable independently of the index fetch: install/uninstall mutate
  // folders on disk, and this is the only way ContentLibrary learns about
  // that (unlike useTileCatalog/useVizStyles it doesn't listen for the
  // `tiles:changed`/`visualizers:changed` events — it's a one-shot modal, not
  // a hook shared with the dashboard).
  const refreshInstalled = useCallback(async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const [tiles, viz] = await Promise.allSettled([
      invoke<InstalledTileFolder[]>('tiles_list'),
      invoke<InstalledVizFolder[]>('visualizers_list'),
    ]);
    if (tiles.status === 'fulfilled') setInstalledTiles(tiles.value);
    if (viz.status === 'fulfilled') setInstalledViz(viz.value);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      await refreshInstalled();
      if (cancelled) return;
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const idx = await invoke<{ bundles: IndexBundle[] }>('marketplace_fetch_index', {
          url: cfgUrl(), pubkey: cfgPubkey(),
        });
        if (!cancelled) setIndex(idx.bundles ?? []);
      } catch { /* fail soft — Task 10 adds an inline notice + retry */ }
    };
    void load();
    return () => { cancelled = true; };
  }, [refreshInstalled]);

  const items = useMemo<CatalogItem[]>(() => mergeCatalog({
    tileMeta: TILE_META,
    vizStyles: BUILTIN_VIZ_STYLES,
    installedTiles,
    installedViz,
    index,
    removed: catalogRemoved,
    // TileCredentialPanel.tsx holds the real "does this bundle still need a
    // secret/config value" logic, but it's shaped around one already-placed
    // instance (per-instance config, live secret-store reads) — there's no
    // clean per-catalog-item answer to reuse without restructuring that
    // component. Left as an empty list rather than half-migrating it — the
    // "needs key" tag is simply unreachable until a future task does that
    // restructuring.
    needsSetup: [],
  }), [installedTiles, installedViz, index, catalogRemoved]);

  const indexByKey = useMemo(() => {
    const m = new Map<string, IndexBundle>();
    for (const b of index) {
      if (b.kind === 'preset') continue;
      m.set(catalogKey(b.kind, b.id), b);
    }
    return m;
  }, [index]);

  const rail = useMemo(() => buildRail(items), [items]);
  // rail[0] is always the 'all' row (buildRail always pushes it) — a safe
  // fallback if the active row's count dropped to zero and it disappeared.
  const active = rail.find((r) => r.id === activeId && !r.heading) ?? rail[0];
  const filtered = useMemo(() => items.filter(active.match), [items, active]);

  const runInstall = useCallback(async (item: CatalogItem, bundle: IndexBundle) => {
    setConfirming(null);
    setBusy(item.key, true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('marketplace_install', {
        url: cfgUrl(), id: bundle.id, version: bundle.version, sha256: bundle.sha256, kind: bundle.kind,
      });
      // Clear any tombstone from a prior removal — otherwise the next
      // seed_sync skips the thing the user just asked to install.
      setCatalogRemoved(withoutRemoval(catalogRemoved, item.key));
      await refreshInstalled();
      flash(`Installed ${item.name}`);
    } catch (e) {
      flash(String(e));
    } finally {
      setBusy(item.key, false);
    }
  }, [catalogRemoved, setCatalogRemoved, refreshInstalled]);

  const handleInstall = (item: CatalogItem) => {
    const bundle = indexByKey.get(item.key);
    if (!bundle) { flash('Not available from the marketplace right now.'); return; }
    // Presets never reach the catalog (mergeCatalog skips them), so every
    // bundle here is code — permissions gate exactly the ones that declare
    // any, same rule as MarketplaceTab's startInstall.
    if (bundle.permissions.length > 0) setConfirming({ item, bundle });
    else void runInstall(item, bundle);
  };

  const handleRemove = async (item: CatalogItem) => {
    setBusy(item.key, true);
    try {
      // Only a genuine installed FOLDER needs uninstalling — `installedVersion`
      // is set exclusively by mergeCatalog's installed-folder pass, so it is
      // the honest signal, not `source === 'bundle'`. Per catalog.ts: "A
      // built-in that is not first-party is a bundle target" — i.e. every
      // not-yet-migrated built-in tile/viz (weatherRadar, dailyChallenge, …)
      // is `source: 'bundle'` too, with `installedVersion: null` and no
      // folder on disk. Gating on source alone sent `marketplace_uninstall`
      // an id like "weatherRadar" for those — camelCase, so the Rust side's
      // `is_safe_id` (lowercase+digits+hyphen only) rejects it outright and
      // the whole remove silently no-ops before the tombstone is ever
      // written. Gating on installedVersion instead skips the invoke for
      // exactly the items that have nothing to uninstall, first-party or not.
      if (item.installedVersion != null) {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('marketplace_uninstall', { id: item.id, kind: item.kind });
      }
      setCatalogRemoved(withRemoval(catalogRemoved, item.key));
      if (item.kind === 'tile') {
        const type: TileType = isBuiltinTileId(item.id) ? item.id : bundleTileId(item.id);
        onRemoveTileInstances(type);
      }
      await refreshInstalled();
      flash(`Removed ${item.name}`);
    } catch (e) {
      flash(String(e));
    } finally {
      setBusy(item.key, false);
    }
  };

  // Esc closes the modal (capture + stopPropagation so App's cascade doesn't
  // also fire) — same convention as TileLibrary. Confirm dialog gets its own
  // Esc via the plain onClick-outside handler below (no separate listener
  // needed at this scale).
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
          position: 'relative',
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
          {notice && (
            <span style={{ fontSize: 11, color: accent, fontFamily: MONO }}>{notice}</span>
          )}
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

          {/* Right pane — card grid, filtered by the active rail row. */}
          <div style={{ flex: 1, padding: 18, overflow: 'auto' }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginBottom: 10 }}>
              {filtered.length} {filtered.length === 1 ? 'item' : 'items'}
            </div>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
              gap: 10, alignContent: 'start',
            }}>
              {filtered.map((item) => (
                <CatalogCard
                  key={item.key}
                  item={item}
                  accent={accent}
                  busy={busyKeys.has(item.key)}
                  onInstall={() => handleInstall(item)}
                  onRemove={() => void handleRemove(item)}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Permissions confirmation — lifted from MarketplaceTab.tsx
            unchanged in behavior. Gates every bundle that declares
            permissions, whether it's a tile or a visualizer. */}
        {confirming && (
          <div
            onClick={() => setConfirming(null)}
            style={{
              position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)',
              display: 'grid', placeItems: 'center', zIndex: 20,
            }}
          >
            <div onClick={(e) => e.stopPropagation()} style={{
              width: 420, background: 'rgba(14,16,22,0.98)',
              border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: 20,
            }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
                Install "{confirming.item.name}"?
              </div>
              <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.55)', marginBottom: 12 }}>
                This {confirming.bundle.kind} requests the following capabilities:
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.7 }}>
                {confirming.bundle.permissions.map((p) => <li key={p}>{describePermission(p)}</li>)}
              </ul>
              <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
                <button onClick={() => setConfirming(null)} style={{
                  padding: '4px 10px', fontSize: 11, cursor: 'pointer', borderRadius: 5,
                  background: 'transparent', color: 'rgba(255,255,255,0.6)',
                  border: '1px solid rgba(255,255,255,0.12)',
                }}>Cancel</button>
                <button
                  onClick={() => void runInstall(confirming.item, confirming.bundle)}
                  style={{
                    padding: '7px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer', borderRadius: 6,
                    background: accent, color: '#000', border: 'none',
                  }}
                >Install &amp; grant</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
