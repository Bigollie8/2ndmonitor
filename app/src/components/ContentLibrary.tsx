import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import {
  mergeCatalog, catalogKey, planRemoval, restoreDefaults, tileInstanceType, secretSetupCandidates,
  applyOptimisticVote,
  type CatalogItem, type IndexBundle, type RatingAgg,
} from '../state/catalog';
import { useMarketplaceAuth } from '../state/marketplaceAuth';
import type { SpectrumState } from '../state/tauri';
import { withRemoval, withoutRemoval, restoreItem } from '../state/removedContent';
import { TILE_META } from '../state/tileMeta';
import { BUILTIN_VIZ_STYLES } from './viz-styles';
import type { InstalledTileFolder } from '../tiles/tileRegistry';
import type { InstalledVizFolder } from '../state/contentRegistry';
import type { TileType, BuiltinTileType } from '../state/layout';
import { buildRail } from './catalogRail';
import { searchItems } from './catalogSearch';
import { CatalogCard } from './CatalogCard';
import { parsePermission } from '../sandbox/manifest';
import { cfgUrl, cfgPubkey } from '../state/marketplaceConfig';
import { getSecret, bundleSecretKey } from '../state/secrets';

const MONO = '"JetBrains Mono", ui-monospace, monospace';

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
  onVisualizerRemoved, onClose,
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
}) {
  const [installedTiles, setInstalledTiles] = useState<InstalledTileFolder[]>([]);
  const [installedViz, setInstalledViz] = useState<InstalledVizFolder[]>([]);
  const [index, setIndex] = useState<IndexBundle[]>([]);
  // Bundle id -> aggregate rating, from GET /ratings. Starts empty and STAYS
  // empty on a failed fetch — see fetchRatings below and MergeCatalogArgs.
  // ratings' doc comment: this is deliberately the same silent-failure
  // contract as a missing preview image, not a retryable error state like
  // `indexUnreachable`. The marketplace's public HTTPS route being down as of
  // this writing (per progress.md) makes this the NORMAL path right now.
  const [ratings, setRatings] = useState<Record<string, RatingAgg>>({});
  // This modal's own sign-in status — StarRating's click-to-rate is gated on
  // it (see StarRating.tsx's ratingDisplay). Settings owns the sign-in FORM;
  // this is a second, independent `useMarketplaceAuth()` mount that only
  // ever reads status (its signIn/signOut are unused here) — the hook has no
  // shared state to desync, each mount just re-asks
  // `marketplace_session_status` on its own.
  const { state: authState } = useMarketplaceAuth();
  const signedIn = authState.status === 'signed-in';
  const [activeId, setActiveId] = useState('all');
  const [query, setQuery] = useState('');
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<{ item: CatalogItem; bundle: IndexBundle } | null>(null);
  const [notice, setNotice] = useState('');
  // Set when the last index fetch (initial load or Retry) failed. Never a red
  // error — mergeCatalog already renders a complete catalog from tables plus
  // installed folders when `index` is `[]` (see state/catalog.ts), so this is
  // informational, not a failure of the catalog itself. Fixes the real
  // 2026-07-30 cold-boot incident: a timed-out index fetch showed a red error
  // banner over an empty grid even though every local item was fine.
  const [indexUnreachable, setIndexUnreachable] = useState(false);
  const [retryingIndex, setRetryingIndex] = useState(false);
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

  // Fetches the index only — never touches installedTiles/installedViz. This
  // is deliberately the exact thing the offline notice's Retry button reruns:
  // a marketplace timeout is a network problem, not a "re-scan disk" problem,
  // and re-scanning disk on every retry would be wasted work plus a flash of
  // stale counts in the rail. Returns bundles on success, null on any failure
  // — it does NOT touch state itself, so callers decide when (or whether) to
  // apply the result. That split matters under React 18 StrictMode: an effect
  // that gates a *shared* "am I still mounted" ref would see that ref
  // flipped false by the dev-only extra mount/cleanup/mount pass before the
  // fetch resolves, and never recover it — the real, lasting mount's fetch
  // would silently never apply. A plain per-invocation `cancelled` local (see
  // the mount effect below) doesn't have that failure mode, because each
  // effect invocation gets its own fresh closure.
  const fetchIndex = useCallback(async (): Promise<IndexBundle[] | null> => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const idx = await invoke<{ bundles: IndexBundle[] }>('marketplace_fetch_index', {
        url: cfgUrl(), pubkey: cfgPubkey(),
      });
      return idx.bundles ?? [];
    } catch {
      return null;
    }
  }, []);

  // Same shape as fetchIndex, and same silent-on-failure contract as
  // PreviewImage's fetch (spec §9): `null` on any failure — offline, the
  // marketplace unreachable, a malformed response — and the caller simply
  // leaves `ratings` at whatever it already was (empty on first load) rather
  // than surfacing an error. Unlike the index, there is no `ratingsUnreachable`
  // notice and no Retry button: a missing rating is not worth interrupting a
  // user over, exactly like a missing preview image.
  const fetchRatings = useCallback(async (): Promise<Record<string, RatingAgg> | null> => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<Record<string, RatingAgg>>('marketplace_fetch_ratings', { url: cfgUrl() });
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await refreshInstalled();
      if (cancelled) return;
      // Independent fetches — a slow/failed ratings request must never delay
      // or block the index (installed folders + index) from rendering.
      const [bundles, ratingsResult] = await Promise.all([fetchIndex(), fetchRatings()]);
      if (cancelled) return;
      if (bundles) { setIndex(bundles); setIndexUnreachable(false); }
      else setIndexUnreachable(true);
      if (ratingsResult) setRatings(ratingsResult);
    })();
    return () => { cancelled = true; };
  }, [refreshInstalled, fetchIndex, fetchRatings]);

  // No mount guard here, unlike the effect above — a modal-closed-mid-fetch
  // race just discards the result into an unmounted component (a dev-only
  // warning, not a crash), the same tolerance every other mutation in this
  // file (install/remove/restore) already has.
  const handleRetryIndex = useCallback(async () => {
    setRetryingIndex(true);
    const bundles = await fetchIndex();
    if (bundles) { setIndex(bundles); setIndexUnreachable(false); }
    else setIndexUnreachable(true);
    setRetryingIndex(false);
  }, [fetchIndex]);

  const indexByKey = useMemo(() => {
    const m = new Map<string, IndexBundle>();
    for (const b of index) {
      if (b.kind === 'preset') continue;
      m.set(catalogKey(b.kind, b.id), b);
    }
    return m;
  }, [index]);

  // Real "needs setup" answer, scoped to declared SECRETS only. Config is
  // per-placed-instance (TileCredentialPanel.tsx), so there is no single
  // catalog-level answer for it without making this component instance-aware
  // — out of scope here (see the doc comment on MergeCatalogArgs.needsSetup
  // in state/catalog.ts). Secrets, unlike config, are namespaced per BUNDLE
  // (bundleSecretKey(bundleId, key) — no instanceId), so they DO have a clean
  // catalog-level answer: an installed bundle "needs setup" when the index
  // says it declares a `secret:` permission and that secret has never been
  // stored.
  //
  // Deliberately keyed on installedTiles/installedViz/indexByKey — NOT on
  // `items` — even though `items` carries `permissions` too: `items` is
  // itself built from this hook's result (see the `items` memo below), so
  // depending on `items` here would make every run of this effect produce a
  // new `items` array next render, re-triggering the effect forever.
  const [needsSetupKeys, setNeedsSetupKeys] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const candidates = secretSetupCandidates(installedTiles, installedViz, indexByKey);
      const results = await Promise.all(candidates.map(async (c) => {
        const values = await Promise.all(c.secretKeys.map((k) => getSecret(bundleSecretKey(c.bundleId, k))));
        return values.some((v) => v == null) ? c.key : null;
      }));
      if (!cancelled) setNeedsSetupKeys(results.filter((k): k is string => k != null));
    })();
    return () => { cancelled = true; };
  }, [installedTiles, installedViz, indexByKey]);

  const items = useMemo<CatalogItem[]>(() => mergeCatalog({
    tileMeta: TILE_META,
    vizStyles: BUILTIN_VIZ_STYLES,
    installedTiles,
    installedViz,
    installedPresets: [],
    index,
    removed: catalogRemoved,
    needsSetup: needsSetupKeys,
    ratings,
  }), [installedTiles, installedViz, index, catalogRemoved, needsSetupKeys, ratings]);

  const rail = useMemo(() => buildRail(items), [items]);
  // rail[0] is always the 'all' row (buildRail always pushes it) — a safe
  // fallback if the active row's count dropped to zero and it disappeared.
  const active = rail.find((r) => r.id === activeId && !r.heading) ?? rail[0];
  const filtered = useMemo(() => items.filter(active.match), [items, active]);
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
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
                  gap: 10, alignContent: 'start',
                }}>
                  {searched.map((item) => (
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
