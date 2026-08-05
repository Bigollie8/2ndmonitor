// ─────────────────────────────────────────────────────────────────────────────
// The merged catalog, once, for every surface that needs it.
//
// Deferred finding #120 left ContentLibrary.tsx unsplit until previews gave a
// second real reason for a data layer to exist. Market v2's Store and Library
// are two views over the same merged catalog, so that condition is now met:
// this hook owns the loading, and both views consume it.
//
// Effectful by nature — Tauri IPC and React state — which is exactly why
// every DECISION was extracted into the pure modules beside this file first
// (catalogSort, catalogFilter, catalogShelves, catalogVersions, appCompat,
// browseState). What is left here is glue.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  mergeCatalog, catalogKey, secretSetupCandidates,
  type CatalogItem, type IndexBundle, type RatingAgg,
  type InstalledPresetFolder,
} from './catalog';
import { TILE_META } from './tileMeta';
import { BUILTIN_VIZ_STYLES } from '../components/viz-styles';
import type { InstalledTileFolder } from '../tiles/tileRegistry';
import type { InstalledVizFolder } from './contentRegistry';
import { useMarketplaceAuth } from './marketplaceAuth';
import { cfgUrl, cfgPubkey } from './marketplaceConfig';
import { getSecret, bundleSecretKey } from './secrets';
import { readCachedIndex, writeCachedIndex, clearCachedIndex } from './indexCache';
import { buildVersionHistory, dateMapOf, type BundleHistory } from './catalogVersions';
import type { DateMap } from './catalogSort';
import { parseCollections, type Collection } from './catalogShelves';

export interface CatalogData {
  items: CatalogItem[];
  index: IndexBundle[];
  indexByKey: Map<string, IndexBundle>;
  history: Map<string, BundleHistory>;
  dates: DateMap;
  collections: Collection[];
  /** The index could not be loaded at all — not even from cache. */
  indexUnreachable: boolean;
  /** The index came from the local cache because the live fetch failed. NOT
   *  an error state: `mergeCatalog` renders a complete catalog from tables
   *  plus installed folders regardless, and the 2026-07-30 cold-boot incident
   *  was exactly a timed-out fetch showing a red banner over content that was
   *  fine. */
  usingCache: boolean;
  retrying: boolean;
  /** The running app version, for `isCompatible`. `'0.0.0'` until Tauri
   *  answers — `isCompatible` fails open, so an unknown version never blocks
   *  an install. */
  appVersion: string;
  signedIn: boolean;
  ratings: Record<string, RatingAgg>;
  setRatings: React.Dispatch<React.SetStateAction<Record<string, RatingAgg>>>;
  refreshInstalled: () => Promise<void>;
  retryIndex: () => Promise<void>;
}

export function useCatalogData(args: { catalogRemoved: string[] }): CatalogData {
  const { catalogRemoved } = args;

  const [installedTiles, setInstalledTiles] = useState<InstalledTileFolder[]>([]);
  const [installedViz, setInstalledViz] = useState<InstalledVizFolder[]>([]);
  const [installedPresets, setInstalledPresets] = useState<InstalledPresetFolder[]>([]);
  const [index, setIndex] = useState<IndexBundle[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  // Bundle id -> aggregate rating, from GET /ratings. Starts empty and STAYS
  // empty on a failed fetch — see fetchRatings below and MergeCatalogArgs.
  // ratings' doc comment: this is deliberately the same silent-failure
  // contract as a missing preview image, not a retryable error state like
  // `indexUnreachable`.
  const [ratings, setRatings] = useState<Record<string, RatingAgg>>({});
  // Sign-in status — StarRating's click-to-rate is gated on it. Settings owns
  // the sign-in FORM; this only ever reads status (its signIn/signOut are
  // unused here) — the hook has no shared state to desync, each mount just
  // re-asks `marketplace_session_status` on its own.
  const { state: authState } = useMarketplaceAuth();
  const signedIn = authState.status === 'signed-in';
  // Set when the index could not be loaded at all. Never a red error —
  // mergeCatalog already renders a complete catalog from tables plus
  // installed folders when `index` is `[]` (see state/catalog.ts), so this is
  // informational, not a failure of the catalog itself. Fixes the real
  // 2026-07-30 cold-boot incident: a timed-out index fetch showed a red error
  // banner over an empty grid even though every local item was fine.
  const [indexUnreachable, setIndexUnreachable] = useState(false);
  const [usingCache, setUsingCache] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [appVersion, setAppVersion] = useState('0.0.0');

  // Re-runnable independently of the index fetch: install/uninstall mutate
  // folders on disk, and this is the only way the catalog learns about that
  // (unlike useTileCatalog/useVizStyles it doesn't listen for the
  // `tiles:changed`/`visualizers:changed` events — the catalog is a modal,
  // not a hook shared with the dashboard).
  const refreshInstalled = useCallback(async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const [tiles, viz, presets] = await Promise.allSettled([
      invoke<InstalledTileFolder[]>('tiles_list'),
      invoke<InstalledVizFolder[]>('visualizers_list'),
      invoke<InstalledPresetFolder[]>('presets_market_list'),
    ]);
    if (tiles.status === 'fulfilled') setInstalledTiles(tiles.value);
    if (viz.status === 'fulfilled') setInstalledViz(viz.value);
    if (presets.status === 'fulfilled') setInstalledPresets(presets.value);
  }, []);

  // Index load order: live fetch first, cached body as the fallback. A cache
  // hit is NOT an error state — see `usingCache`'s doc comment.
  //
  // Fetches the index only — never touches installedTiles/installedViz. This
  // is deliberately the exact thing the offline notice's Retry button reruns:
  // a marketplace timeout is a network problem, not a "re-scan disk" problem.
  // It does NOT touch state itself, so callers decide when (or whether) to
  // apply the result. That split matters under React 18 StrictMode: an effect
  // that gates a *shared* "am I still mounted" ref would see that ref
  // flipped false by the dev-only extra mount/cleanup/mount pass before the
  // fetch resolves, and never recover it — the real, lasting mount's fetch
  // would silently never apply. A plain per-invocation `cancelled` local (see
  // the mount effect below) doesn't have that failure mode, because each
  // effect invocation gets its own fresh closure.
  const loadIndex = useCallback(async (): Promise<{
    bundles: IndexBundle[] | null; fromCache: boolean;
  }> => {
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      const res = await invoke<{ body: string; value: { bundles: IndexBundle[] } }>(
        'marketplace_fetch_index_body', { url: cfgUrl(), pubkey: cfgPubkey() },
      );
      writeCachedIndex(res.body, cfgUrl());
      return { bundles: res.value.bundles ?? [], fromCache: false };
    } catch {
      const cached = readCachedIndex(cfgUrl());
      if (!cached) return { bundles: null, fromCache: false };
      try {
        const value = await invoke<{ bundles: IndexBundle[] }>(
          'marketplace_verify_index_body', { body: cached, pubkey: cfgPubkey() },
        );
        return { bundles: value.bundles ?? [], fromCache: true };
      } catch {
        // A cached body that no longer verifies is worse than none — the key
        // rotated, or something tampered with localStorage. Drop it.
        clearCachedIndex(cfgUrl());
        return { bundles: null, fromCache: false };
      }
    }
  }, []);

  // Same silent-on-failure contract as PreviewImage's fetch: `null` on any
  // failure — offline, the marketplace unreachable, a malformed response — and
  // the caller simply leaves `ratings` at whatever it already was. Unlike the
  // index, there is no `ratingsUnreachable` notice and no Retry button: a
  // missing rating is not worth interrupting a user over.
  const fetchRatings = useCallback(async (): Promise<Record<string, RatingAgg> | null> => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<Record<string, RatingAgg>>('marketplace_fetch_ratings', { url: cfgUrl() });
    } catch {
      return null;
    }
  }, []);

  // Collections are unsigned browse data (see server/src/collections.rs) and
  // independently fallible, exactly like ratings: a failure leaves the list
  // empty and the Discover home simply has no collection shelves.
  const fetchCollections = useCallback(async (): Promise<Collection[]> => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      // The command returns the server's raw JSON, and the live server sends
      // an ENVELOPE ({"collections":[...]}), not the bare array this promised.
      // Trusting the wire shape here is what black-screened the store — see
      // parseCollections. Never hand un-parsed wire data to state.
      const raw = await invoke<unknown>('marketplace_fetch_collections', { url: cfgUrl() });
      return parseCollections(raw);
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { getVersion } = await import('@tauri-apps/api/app');
        const v = await getVersion();
        if (!cancelled) setAppVersion(v);
      } catch {
        // Outside Tauri, or the API is unavailable. isCompatible fails open,
        // so '0.0.0' never blocks an install.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // The per-invocation `cancelled` local, NOT a shared mountedRef — see
  // loadIndex's doc comment for why.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await refreshInstalled();
      if (cancelled) return;
      // Independent fetches — a slow/failed ratings or collections request
      // must never delay the index from rendering.
      const [idx, ratingsResult, cols] = await Promise.all([
        loadIndex(), fetchRatings(), fetchCollections(),
      ]);
      if (cancelled) return;
      if (idx.bundles) {
        setIndex(idx.bundles);
        setIndexUnreachable(false);
        setUsingCache(idx.fromCache);
      } else {
        setIndexUnreachable(true);
        setUsingCache(false);
      }
      if (ratingsResult) setRatings(ratingsResult);
      setCollections(cols);
    })();
    return () => { cancelled = true; };
  }, [refreshInstalled, loadIndex, fetchRatings, fetchCollections]);

  // No mount guard here, unlike the effect above — a modal-closed-mid-fetch
  // race just discards the result into an unmounted component (a dev-only
  // warning, not a crash), the same tolerance every mutation in ContentLibrary
  // already has.
  const retryIndex = useCallback(async () => {
    setRetrying(true);
    const idx = await loadIndex();
    if (idx.bundles) {
      setIndex(idx.bundles);
      setIndexUnreachable(false);
      setUsingCache(idx.fromCache);
    } else {
      setIndexUnreachable(true);
      setUsingCache(false);
    }
    setRetrying(false);
  }, [loadIndex]);

  const indexByKey = useMemo(() => {
    const m = new Map<string, IndexBundle>();
    for (const b of index) {
      m.set(catalogKey(b.kind, b.id), b);
    }
    return m;
  }, [index]);

  // Real "needs setup" answer, scoped to declared SECRETS only. Config is
  // per-placed-instance (TileCredentialPanel.tsx), so there is no single
  // catalog-level answer for it without making the consumer instance-aware
  // (see the doc comment on MergeCatalogArgs.needsSetup in state/catalog.ts).
  // Secrets, unlike config, are namespaced per BUNDLE (bundleSecretKey(
  // bundleId, key) — no instanceId), so they DO have a clean catalog-level
  // answer: an installed bundle "needs setup" when the index says it declares
  // a `secret:` permission and that secret has never been stored.
  //
  // Deliberately keyed on installedTiles/installedViz/indexByKey — NOT on
  // `items` — even though `items` carries `permissions` too: `items` is
  // itself built from this effect's result (see the `items` memo below), so
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
    installedPresets,
    index,
    removed: catalogRemoved,
    needsSetup: needsSetupKeys,
    ratings,
  }), [installedTiles, installedViz, installedPresets, index, catalogRemoved, needsSetupKeys, ratings]);

  const history = useMemo(() => buildVersionHistory(index), [index]);
  const dates = useMemo(() => dateMapOf(history), [history]);

  return {
    items, index, indexByKey, history, dates, collections,
    indexUnreachable, usingCache, retrying, appVersion, signedIn,
    ratings, setRatings, refreshInstalled, retryIndex,
  };
}
