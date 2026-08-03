// ─────────────────────────────────────────────────────────────────────────────
// Install / remove / restore, lifted out of ContentLibrary.tsx.
//
// Moved VERBATIM IN SEMANTICS. Three details here look incidental and each
// exists because of a specific bug — the comments below are carried across
// with the code so a future reader does not "simplify" them away.
//
// The pure decisions underneath (`planRemoval`, `restoreItem`,
// `restoreDefaults`) were already extracted and tested; they move untouched.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  planRemoval, restoreDefaults, type CatalogItem, type IndexBundle,
} from '../state/catalog';
import { withRemoval, withoutRemoval, restoreItem } from '../state/removedContent';
import type { TileType } from '../state/layout';
import { cfgUrl } from '../state/marketplaceConfig';

export interface ContentMutations {
  busyKeys: Set<string>;
  /** The single value every action button's `disabled` reads. */
  anyBusy: boolean;
  restoring: boolean;
  notice: string;
  flash: (msg: string) => void;
  install: (item: CatalogItem, bundle: IndexBundle) => Promise<void>;
  remove: (item: CatalogItem) => Promise<void>;
  restore: (item: CatalogItem) => Promise<void>;
  restoreAllDefaults: () => Promise<void>;
}

export function useContentMutations(args: {
  catalogRemoved: string[];
  setCatalogRemoved: (n: string[]) => void;
  refreshInstalled: () => Promise<void>;
  onRemoveTileInstances: (t: TileType) => void;
  onVisualizerRemoved: (key: string) => void;
}): ContentMutations {
  const {
    catalogRemoved, setCatalogRemoved, refreshInstalled,
    onRemoveTileInstances, onVisualizerRemoved,
  } = args;

  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
  const [restoring, setRestoring] = useState(false);
  const [notice, setNotice] = useState('');

  const setBusy = (key: string, busy: boolean) => {
    setBusyKeys((prev) => {
      const next = new Set(prev);
      if (busy) next.add(key); else next.delete(key);
      return next;
    });
  };

  // The timer id lives in a REF, not state: a second flash while one is
  // pending clears the first timer instead of stacking two, so an older
  // flash's timeout cannot blank a newer notice out from under it.
  const flashTimer = useRef<ReturnType<typeof setTimeout>>();
  const flash = useCallback((msg: string) => {
    if (flashTimer.current !== undefined) clearTimeout(flashTimer.current);
    setNotice(msg);
    flashTimer.current = setTimeout(() => setNotice(''), 3000);
  }, []);
  useEffect(() => () => {
    if (flashTimer.current !== undefined) clearTimeout(flashTimer.current);
  }, []);

  const install = useCallback(async (item: CatalogItem, bundle: IndexBundle) => {
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
      // A live MilkDrop surface keeps its own preset picker state rather than
      // re-querying presets_market_list every render; this event is how it
      // learns disk changed. Fires on install, remove AND restore.
      if (item.kind === 'preset') window.dispatchEvent(new Event('market-presets:changed'));
      flash(`Installed ${item.name}`);
    } catch (e) {
      flash(String(e));
    } finally {
      setBusy(item.key, false);
    }
  }, [catalogRemoved, setCatalogRemoved, refreshInstalled, flash]);

  // planRemoval (state/catalog.ts) is the pure, tested decision for what
  // follows — the honest uninstall gate (installedVersion, not source), the
  // tombstone key, and the dashboard TileType to strip. See its doc comment
  // for the "weatherRadar" bug this guards against.
  const remove = useCallback(async (item: CatalogItem) => {
    const plan = planRemoval(item);
    setBusy(item.key, true);
    try {
      if (plan.uninstall) {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('marketplace_uninstall', { id: item.id, kind: item.kind });
      }
      // Computes its next list from the `catalogRemoved` captured at call
      // time. Safe ONLY because every action is disabled while any mutation
      // is in flight (`anyBusy` below) — two overlapping writes would
      // otherwise silently revert each other's tombstone.
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
  }, [catalogRemoved, setCatalogRemoved, refreshInstalled, onRemoveTileInstances, onVisualizerRemoved, flash]);

  // Per-item recovery. `restoreItem` (state/removedContent.ts) is the pure
  // decision: drop just this key from the tombstone list, then re-sync seeds
  // against that narrowed list so a bundle whose folder was actually deleted
  // comes back, without touching any other tombstone. Works offline for every
  // seeded item — no index lookup, unlike install.
  const restore = useCallback(async (item: CatalogItem) => {
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
  }, [catalogRemoved, setCatalogRemoved, refreshInstalled, flash]);

  // The clear-before-sync ordering decision lives in the pure, tested
  // `restoreDefaults` (state/catalog.ts) — this is just the real closures it
  // is injected with, plus the busy flag and post-sync bookkeeping.
  const restoreAllDefaults = useCallback(async () => {
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

  return {
    busyKeys,
    anyBusy: busyKeys.size > 0 || restoring,
    restoring,
    notice,
    flash,
    install,
    remove,
    restore,
    restoreAllDefaults,
  };
}
