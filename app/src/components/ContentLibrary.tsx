import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import {
  planRemoval, restoreDefaults, tileInstanceType, applyOptimisticVote,
  type CatalogItem, type IndexBundle,
} from '../state/catalog';
import type { SpectrumState } from '../state/tauri';
import { withRemoval, withoutRemoval, restoreItem } from '../state/removedContent';
import { TILE_META } from '../state/tileMeta';
import type { TileType, BuiltinTileType } from '../state/layout';
import { buildRail } from './catalogRail';
import { filterItems } from '../state/catalogFilter';
import { useCatalogData } from '../state/useCatalogData';
import { searchItems } from './catalogSearch';
import { CatalogCard } from './CatalogCard';
import { PresetRow } from './PresetRow';
import { parsePermission } from '../sandbox/manifest';
import { cfgUrl } from '../state/marketplaceConfig';

const MONO = '"JetBrains Mono", ui-monospace, monospace';

/** The running app version, used only for the `incompatible` facet. A
 *  constant here for now; Phase 2 Task 10 replaces it with the real value the
 *  shared data hook reads from Tauri. */
const APP_VERSION = '0.8.0';

/** Human phrasing for a permission string, shown in the install confirm
 *  dialog. */
function describePermission(p: string): string {
  const parsed = parsePermission(p);
  if (!parsed.ok) return p;
  if (parsed.perm.kind === 'net') return `Access the internet at ${parsed.perm.host}`;
  if (parsed.perm.kind === 'secret') return `Store a credential named "${parsed.perm.key}"`;
  return `Run the app command "${parsed.perm.command}"`;
}

/** The unified content catalog: a fixed-width category rail with live counts
 *  (from `buildRail`, a pure function — see catalogRail.ts) and a card grid
 *  with real install/remove actions for both backings (compile-time
 *  built-ins and marketplace bundles). Same modal-frame visual language as
 *  TileLibrary: dark translucent panel, hairline borders, JetBrains Mono
 *  metadata, accent passed in as a prop. Search (catalogSearch.ts), the
 *  offline notice, the "search all content" widen affordance and the
 *  restore-defaults empty state are Task 10. */
export function ContentLibrary({
  accent, accent2, spectrumRef, catalogRemoved, setCatalogRemoved, onRemoveTileInstances, onAddTileInstance,
  onVisualizerRemoved, onClose, initialRail,
}: {
  accent: string;
  /** Second theme color, threaded to `CatalogCard` for a `live` card's
   *  sandboxed render — same value App.tsx hands the hero surface. */
  accent2: string;
  /** Live audio-spectrum ref — App.tsx's single `useSpectrumRef()` call,
   *  threaded down (not re-created here) so a `live` card's sandbox reacts to
   *  the same audio the hero surface does, and so there is only ever one
   *  `audio:spectrum` Tauri listener alive. */
  spectrumRef?: MutableRefObject<SpectrumState>;
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
  /** Places a new instance of `type` on the active profile's active
   *  orientation, at the first free rect near its default position — the
   *  same placement logic the old TileLibrary.onAdd used (see App.tsx at
   *  24f6166^). The catalog's "+ Add" button is the only surviving way to
   *  place a tile outside edit mode now that the catalog replaced the Tile
   *  Library's browse-and-add grid. */
  onAddTileInstance: (type: TileType) => void;
  /** Called after a visualizer item is actually removed (uninstall done,
   *  tombstone written), with its catalog key. If the currently active
   *  `vizMode` names the just-removed style, App resets it to the first
   *  surviving one — vizMode is the visualizer's equivalent of a placed tile
   *  instance, and it is persisted, so leaving it pointed at a removed style
   *  would keep rendering it (and keep rendering it after a restart). */
  onVisualizerRemoved: (key: string) => void;
  onClose: () => void;
  /** Rail row id to select on open — e.g. App.tsx's MilkDrop picker "browse
   *  presets" button opens straight to `'preset:all'` instead of the default
   *  `'all'`. Read exactly once via `useState(initialRail ?? 'all')`: this is
   *  the initial selection for a freshly-mounted modal, not a controlled
   *  value that keeps following the prop across the modal's lifetime — the
   *  category rail's own buttons own `activeId` after that. */
  initialRail?: string;
}) {
  // Every piece of catalog loading lives in the shared hook now — two views
  // (this one and the Market v2 Store) need the identical merged catalog, so
  // duplicating the fetch/merge here would be two copies to drift.
  const {
    items, indexByKey, indexUnreachable, usingCache, retrying: retryingIndex,
    signedIn, ratings, setRatings, refreshInstalled, retryIndex: handleRetryIndex,
  } = useCatalogData({ catalogRemoved });
  const [activeId, setActiveId] = useState(initialRail ?? 'all');
  const [query, setQuery] = useState('');
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<{ item: CatalogItem; bundle: IndexBundle } | null>(null);
  const [notice, setNotice] = useState('');
  const [restoring, setRestoring] = useState(false);

  const setBusy = (key: string, busy: boolean) => {
    setBusyKeys((prev) => {
      const next = new Set(prev);
      if (busy) next.add(key); else next.delete(key);
      return next;
    });
  };

  // Auto-clears after 3s. The timer id lives in a ref (not state) so a second
  // flash while one is already pending clears the first timer instead of
  // stacking two — without this an older flash's timeout could blank a
  // newer notice out from under it. Also cleared on unmount.
  const flashTimer = useRef<ReturnType<typeof setTimeout>>();
  const flash = useCallback((msg: string) => {
    if (flashTimer.current !== undefined) clearTimeout(flashTimer.current);
    setNotice(msg);
    flashTimer.current = setTimeout(() => setNotice(''), 3000);
  }, []);
  useEffect(() => () => {
    if (flashTimer.current !== undefined) clearTimeout(flashTimer.current);
  }, []);


  const rail = useMemo(() => buildRail(items), [items]);
  // rail[0] is always the 'all' row (buildRail always pushes it) — a safe
  // fallback if the active row's count dropped to zero and it disappeared.
  const active = rail.find((r) => r.id === activeId && !r.heading) ?? rail[0];
  const filtered = useMemo(
    () => filterItems(items, active.facets, APP_VERSION),
    [items, active],
  );
  // Search is scoped to the active rail slice on purpose — a result surfacing
  // from a category the user didn't select would be confusing. The "search
  // all content" button below (setActiveId('all')) is the explicit, opt-in
  // way to widen it — query state is untouched by that switch, so the search
  // carries over.
  const searched = useMemo(() => searchItems(filtered, query), [filtered, query]);
  // A real search with zero hits in the active slice — distinct from an
  // empty catalog (items.length === 0), which has its own branch below.
  const noMatches = query.trim() !== '' && searched.length === 0;
  // Only offer to widen when there's an actually wider slice to search —
  // 'all' already is that slice, so a still-empty result there is a genuine
  // "no matches", not something a wider search could fix. `noMatches` is
  // still shown in that case (see the render branch), just without the
  // widen button, so a zero-hit search in 'all' doesn't read as an empty
  // catalog.
  const canWiden = noMatches && active.id !== 'all';
  // Presets never render as a `CatalogCard` — they get their own compact
  // `PresetRow` list below the grid instead (see the render branch). This
  // split is the whole of the "which UI a kind gets" decision: it falls out
  // of `active.match` and `searchItems` the same as everything else, so
  // 'preset:all' (all rows, no cards), 'all' (cards then rows), a mixed rail
  // row ('installed'/'updates'/'removed'), and search all fall out correctly
  // with no special-casing of the active rail id.
  const cardItems = searched.filter((i) => i.kind !== 'preset');
  const presetItems = searched.filter((i) => i.kind === 'preset');

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
      // A live MilkDrop surface (Task 6) keeps its own preset picker state
      // rather than re-querying `presets_market_list` on every render — this
      // event is how it learns a preset install/update just changed what's
      // on disk. Only presets have a live surface that cares; a tile or
      // visualizer install already has its own refresh path (tiles_list/
      // visualizers_list via refreshInstalled above, and the dashboard's own
      // `tiles:changed`/`visualizers:changed` listeners elsewhere).
      if (item.kind === 'preset') window.dispatchEvent(new Event('market-presets:changed'));
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
    // A preset's `IndexBundle.permissions` is always `[]` — it's data, not
    // sandboxed code, so it declares nothing to gate — which means every
    // preset already takes this direct-install path, same as any tile/
    // visualizer bundle that happens to declare no permissions.
    if (bundle.permissions.length > 0) setConfirming({ item, bundle });
    else void runInstall(item, bundle);
  };

  // planRemoval (state/catalog.ts) is the pure, tested decision for what
  // follows — the honest uninstall gate (installedVersion, not source), the
  // tombstone key, and the dashboard TileType to strip. See its doc comment
  // for the "weatherRadar" bug this guards against.
  const handleRemove = async (item: CatalogItem) => {
    const plan = planRemoval(item);
    setBusy(item.key, true);
    try {
      if (plan.uninstall) {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('marketplace_uninstall', { id: item.id, kind: item.kind });
      }
      // setCatalogRemoved below computes its next list from the
      // `catalogRemoved` prop closed over at handleRemove's own call time.
      // That is safe even when a second removal starts before this one's
      // `await` above resolves, because every action button is disabled
      // while `busyKeys.size > 0` (see the `disabled` prop passed to
      // CatalogCard below) — only one mutation can be in flight at a time,
      // so there is no longer a window for two overlapping writes to race
      // and one silently revert the other's tombstone.
      setCatalogRemoved(withRemoval(catalogRemoved, plan.tombstoneKey));
      if (plan.instanceType != null) onRemoveTileInstances(plan.instanceType);
      if (item.kind === 'visualizer') onVisualizerRemoved(plan.tombstoneKey);
      await refreshInstalled();
      if (item.kind === 'preset') window.dispatchEvent(new Event('market-presets:changed'));
      flash(`Removed ${item.name}`);
    } catch (e) {
      flash(String(e));
    } finally {
      setBusy(item.key, false);
    }
  };

  // Places a new instance of an installed tile on the dashboard — the
  // catalog's counterpart to Remove, restoring the "add a tile" affordance
  // the old TileLibrary offered (see App.tsx's onAddTileInstance for the
  // placement logic). Visualizers have no dashboard instance, so this is
  // never wired for a visualizer card.
  const handleAdd = (item: CatalogItem) => {
    const type = tileInstanceType(item);
    if (type != null) onAddTileInstance(type);
  };

  // Critical 2's per-item recovery path — the "Removed" rail row's Restore
  // button. `restoreItem` (state/removedContent.ts) is the pure decision:
  // drop just this key from the tombstone list, then re-sync seeds against
  // that narrowed list so a bundle whose folder was actually deleted comes
  // back, without touching any other tombstone. Works offline for every
  // seeded item — no `indexByKey` lookup, unlike `handleInstall` — which is
  // also what closes Important 5 (offline single-item reinstall).
  const handleRestore = async (item: CatalogItem) => {
    setBusy(item.key, true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await restoreItem(item.key, {
        removed: catalogRemoved,
        setRemoved: setCatalogRemoved,
        seedSync: (removed) => invoke<string[]>('seed_sync', { removed }),
      });
      await refreshInstalled();
      if (item.kind === 'preset') window.dispatchEvent(new Event('market-presets:changed'));
      flash(`Restored ${item.name}`);
    } catch (e) {
      flash(String(e));
    } finally {
      setBusy(item.key, false);
    }
  };

  // Which cards have a rate request in flight — separate from `busyKeys`
  // (install/remove) on purpose, see CatalogCard's `ratingBusy` doc comment:
  // rating one card must not visually lock every other card's Install/Remove
  // button the way an install/remove mutation does.
  const [ratingBusyKeys, setRatingBusyKeys] = useState<Set<string>>(new Set());

  // Bundle id -> the stars THIS content-library session last optimistically
  // voted for it. Doubles as "have I voted on this bundle before, this
  // session" (key presence) — added per D3 review's Important 2:
  // `applyOptimisticVote` needs the PREVIOUS vote's value to replace rather
  // than add on a re-vote, and a bare membership Set can't supply that by
  // itself. Reset implicitly whenever this component remounts (plain React
  // state, not persisted) — a fresh Content Library session has no memory
  // of a prior session's votes either, the same residual gap
  // `applyOptimisticVote`'s doc comment notes for a genuinely first vote.
  const [votedStars, setVotedStars] = useState<Record<string, number>>({});

  // Posts a vote via marketplace_rate and optimistically updates `ratings`
  // via applyOptimisticVote (state/catalog.ts) before the request resolves
  // — the "optimistically updates" half of Task 3. `item.id` (the bare
  // bundle id), not `item.key`, is both the ratings-map key and what the
  // Rust command sends the server — see MergeCatalogArgs.ratings' doc
  // comment for why the two ids differ. On failure BOTH the optimistic
  // rating and `votedStars` are rolled back to exactly what they were before
  // this call (not just cleared — a previously-known rating, or a genuinely
  // earlier vote this session already cast, must not vanish because a
  // re-vote's network request failed) and the error is flashed, same as
  // every other mutation in this file.
  const handleRate = useCallback(async (item: CatalogItem, stars: number) => {
    const bundleId = item.id;
    const previousRating = ratings[bundleId] ?? null;
    const previousStars = votedStars[bundleId] ?? null;
    setRatings((prev) => ({ ...prev, [bundleId]: applyOptimisticVote(previousRating, stars, previousStars) }));
    setVotedStars((prev) => ({ ...prev, [bundleId]: stars }));
    setRatingBusyKeys((prev) => new Set(prev).add(item.key));
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('marketplace_rate', { url: cfgUrl(), id: bundleId, stars });
    } catch (e) {
      setRatings((prev) => {
        const next = { ...prev };
        if (previousRating) next[bundleId] = previousRating; else delete next[bundleId];
        return next;
      });
      setVotedStars((prev) => {
        const next = { ...prev };
        if (previousStars != null) next[bundleId] = previousStars; else delete next[bundleId];
        return next;
      });
      flash(String(e));
    } finally {
      setRatingBusyKeys((prev) => {
        const next = new Set(prev);
        next.delete(item.key);
        return next;
      });
    }
  }, [ratings, votedStars, flash]);

  // The empty state's recovery path. The actual clear-before-sync ordering
  // decision lives in the pure, tested `restoreDefaults` (state/catalog.ts)
  // — this is just the real closures it's injected with, plus the busy flag
  // and post-sync bookkeeping that only make sense here.
  const handleRestoreDefaults = useCallback(async () => {
    setRestoring(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await restoreDefaults({
        clearRemoved: () => setCatalogRemoved([]),
        seedSync: (removed) => invoke<string[]>('seed_sync', { removed }),
      });
      await refreshInstalled();
      flash('Restored defaults');
    } catch (e) {
      flash(String(e));
    } finally {
      setRestoring(false);
    }
  }, [setCatalogRemoved, refreshInstalled, flash]);

  // Esc closes the whole modal (capture + stopPropagation so App's cascade
  // doesn't also fire) — same convention as TileLibrary. There is no separate
  // Esc handler for the confirm dialog below: it has no keydown listener of
  // its own, only a click-outside handler, so pressing Esc while it's open
  // falls through to this listener and closes the whole modal (dialog
  // included), not just the dialog.
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
          background: 'var(--surface-overlay, rgba(20,22,28,0.98))', backdropFilter: 'blur(20px)',
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
            {/* rail[0] is always the 'all' row, whose count excludes removed
                items (see catalogRail.ts) — items.length would double-count
                by including every tombstoned item mergeCatalog now keeps
                around for the "Removed" row. */}
            · {rail[0]?.count ?? items.length} total
          </span>
          <div style={{ flex: 1 }} />
          <div style={{ position: 'relative', width: 190 }}>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              aria-label="Search catalog"
              style={{
                width: '100%', boxSizing: 'border-box', padding: '5px 24px 5px 9px',
                fontSize: 11.5, fontFamily: 'inherit',
                background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.85)',
                border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6,
              }}
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                title="Clear search"
                style={{
                  position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
                  width: 16, height: 16, padding: 0, fontSize: 11, lineHeight: 1,
                  background: 'transparent', color: 'rgba(255,255,255,0.45)',
                  border: 'none', cursor: 'pointer',
                }}
              >×</button>
            )}
          </div>
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

          {/* Right pane — card grid, filtered by the active rail row and
              search. The offline notice sits above the grid, not in place of
              it: mergeCatalog already renders a full catalog from tables plus
              installed folders when the index fetch fails, so there is
              always something real to show here. */}
          <div style={{ flex: 1, padding: 18, overflow: 'auto' }}>
            {indexUnreachable && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px', marginBottom: 12, borderRadius: 8,
                background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.09)',
              }}>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', flex: 1 }}>
                  marketplace unreachable — showing local content
                </span>
                <button
                  onClick={() => void handleRetryIndex()}
                  disabled={retryingIndex}
                  style={{
                    padding: '3px 10px', fontSize: 10.5, fontWeight: 600, borderRadius: 5,
                    background: 'transparent', color: 'rgba(255,255,255,0.7)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    cursor: retryingIndex ? 'not-allowed' : 'pointer',
                    opacity: retryingIndex ? 0.55 : 1,
                  }}
                >{retryingIndex ? 'Retrying…' : 'Retry'}</button>
              </div>
            )}

            {/* A cache hit is NOT the unreachable state: the catalog below is
                the real, signature-verified one, just not fetched a moment
                ago. Same shape as the notice above so the two never read as
                different severities. */}
            {usingCache && !indexUnreachable && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px', marginBottom: 12, borderRadius: 8,
                background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.09)',
              }}>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', flex: 1 }}>
                  showing cached catalog — marketplace unreachable
                </span>
                <button
                  onClick={() => void handleRetryIndex()}
                  disabled={retryingIndex}
                  style={{
                    padding: '3px 10px', fontSize: 10.5, fontWeight: 600, borderRadius: 5,
                    background: 'transparent', color: 'rgba(255,255,255,0.7)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    cursor: retryingIndex ? 'not-allowed' : 'pointer',
                    opacity: retryingIndex ? 0.55 : 1,
                  }}
                >{retryingIndex ? 'Retrying…' : 'Retry'}</button>
              </div>
            )}

            {/* Bulk escape hatch, moved out of the (practically unreachable)
                empty-catalog branch below and into the "Removed" row itself —
                Critical 2's fix. Each card here already has its own Restore
                action; this is for "just put everything back" instead of one
                at a time. */}
            {active.id === 'removed' && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px', marginBottom: 12, borderRadius: 8,
                background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.09)',
              }}>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', flex: 1 }}>
                  {catalogRemoved.length} removed from the catalog — restore one at a time below, or bring everything back at once.
                </span>
                <button
                  onClick={() => void handleRestoreDefaults()}
                  disabled={restoring}
                  style={{
                    padding: '3px 10px', fontSize: 10.5, fontWeight: 600, borderRadius: 5,
                    background: 'transparent', color: 'rgba(255,255,255,0.7)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    cursor: restoring ? 'not-allowed' : 'pointer',
                    opacity: restoring ? 0.55 : 1,
                  }}
                >{restoring ? 'Restoring…' : 'Restore all defaults'}</button>
              </div>
            )}

            {items.length === 0 ? (
              // Defensive fallback, not a reachable state in practice since
              // Critical 2's fix: mergeCatalog now keeps every removed item
              // (flagged, see catalog.ts pass 4) rather than dropping most of
              // them, so `items` only shrinks to nothing if TILE_META and
              // BUILTIN_VIZ_STYLES were both empty. Left in place rather than
              // deleted — a still-correct answer for a case that shouldn't
              // occur is cheaper than a component that assumes it can't.
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10,
                padding: '28px 4px', maxWidth: 360,
              }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>
                  Nothing in the catalog
                </div>
                <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>
                  Everything has been removed. Restore defaults to bring back the built-in
                  tiles and visualizers.
                </div>
                <button
                  onClick={() => void handleRestoreDefaults()}
                  disabled={restoring}
                  style={{
                    padding: '6px 14px', fontSize: 11.5, fontWeight: 600, borderRadius: 6,
                    background: accent, color: '#000', border: 'none',
                    cursor: restoring ? 'not-allowed' : 'pointer',
                    opacity: restoring ? 0.6 : 1,
                  }}
                >{restoring ? 'Restoring…' : 'Restore defaults'}</button>
              </div>
            ) : canWiden ? (
              // Search hit nothing in the selected rail slice, but there's a
              // wider slice ('all') to try — offer it explicitly rather than
              // silently widening, which would surface a result from a
              // category the user didn't pick.
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10,
                padding: '28px 4px', maxWidth: 360,
              }}>
                <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.5)' }}>
                  No matches for "{query.trim()}" in {active.label}.
                </div>
                <button
                  onClick={() => setActiveId('all')}
                  style={{
                    padding: '6px 14px', fontSize: 11.5, fontWeight: 600, borderRadius: 6,
                    background: 'transparent', color: accent,
                    border: `1px solid ${accent}55`, cursor: 'pointer',
                  }}
                >Search all content</button>
              </div>
            ) : noMatches ? (
              // Zero hits searching the 'all' slice itself — there is no
              // wider slice to offer, so no widen button, but this still
              // needs the same "No matches" messaging as the canWiden case
              // above: falling through to the plain grid here would render
              // "0 items" over an empty grid, which reads as an empty
              // catalog rather than a search that simply missed.
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10,
                padding: '28px 4px', maxWidth: 360,
              }}>
                <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.5)' }}>
                  No matches for "{query.trim()}".
                </div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginBottom: 10 }}>
                  {searched.length} {searched.length === 1 ? 'item' : 'items'}
                </div>
                {/* Split by kind, not rendered by rail row: a preset is never
                    a card here, in any of 'all' (cards then rows), a mixed
                    rail row like 'installed'/'updates'/'removed', or a search
                    — and 'preset:all' naturally renders as an empty
                    `cardItems` grid (skipped) plus every row below, with no
                    special-casing of the active rail id needed. */}
                {cardItems.length > 0 && (
                  <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
                    gap: 10, alignContent: 'start',
                  }}>
                    {cardItems.map((item) => (
                      <CatalogCard
                        key={item.key}
                        item={item}
                        accent={accent}
                        accent2={accent2}
                        spectrumRef={spectrumRef}
                        glyph={item.kind === 'tile' && item.id in TILE_META
                          ? TILE_META[item.id as BuiltinTileType].icon
                          : null}
                        busy={busyKeys.has(item.key)}
                        disabled={busyKeys.size > 0 || restoring}
                        onInstall={() => handleInstall(item)}
                        onRemove={() => void handleRemove(item)}
                        onAdd={item.kind === 'tile' && item.installed ? () => handleAdd(item) : undefined}
                        onRestore={() => void handleRestore(item)}
                        signedIn={signedIn}
                        ratingBusy={ratingBusyKeys.has(item.key)}
                        onRate={(stars) => void handleRate(item, stars)}
                      />
                    ))}
                  </div>
                )}
                {presetItems.length > 0 && (
                  <div style={{ marginTop: cardItems.length > 0 ? 16 : 0 }}>
                    <div style={{
                      fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                      color: 'rgba(255,255,255,0.35)', marginBottom: 6,
                    }}>
                      MilkDrop presets · {presetItems.length}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {presetItems.map((item) => (
                        <PresetRow
                          key={item.key}
                          item={item}
                          accent={accent}
                          busy={busyKeys.has(item.key)}
                          disabled={busyKeys.size > 0 || restoring}
                          onInstall={() => handleInstall(item)}
                          onRemove={() => void handleRemove(item)}
                          onRestore={() => void handleRestore(item)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
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
              width: 420, background: 'var(--surface-overlay, rgba(14,16,22,0.98))',
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
                  disabled={busyKeys.has(confirming.item.key)}
                  style={{
                    padding: '7px 16px', fontSize: 12, fontWeight: 600, borderRadius: 6,
                    background: accent, color: '#000', border: 'none',
                    cursor: busyKeys.has(confirming.item.key) ? 'not-allowed' : 'pointer',
                    opacity: busyKeys.has(confirming.item.key) ? 0.6 : 1,
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
