// NOTE: .ts, no JSX in this file — see viz-styles.ts's module comment for why
// the plain style table stays React-free. This hook is the React-aware layer
// on top of it.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { BUILTIN_VIZ_STYLES } from './viz-styles';
import { mergeVizStyles, type InstalledVizFolder, type VizStyleEntry } from '../state/contentRegistry';
import { applyRemovals } from '../state/removedContent';
import { isSeedSettled, subscribeSeedSettled } from '../state/seedStatus';

export interface VizStylesResult {
  styles: VizStyleEntry[];
  /** True once the catalog is actually knowable: the first `visualizers_list`
   *  call has settled (success or failure) AND boot seeding has finished.
   *  Callers that need to distinguish "no bundles installed" from "haven't
   *  heard back yet" — e.g. deciding whether a `bundle:` mode is really absent
   *  — must gate on this instead of checking `styles` alone.
   *
   *  The seed half is not paranoia. `seed_sync` runs fire-and-forget after
   *  hydration and after first paint, while `visualizers_list` resolves on
   *  mount, so on EVERY launch there is a window where the list has honestly
   *  resolved but the seeder has not yet written the folders it is about to.
   *  Reporting `loaded` then makes an about-to-exist bundle look permanently
   *  absent — which is how an upgrading user's `bundle:bars` selection ends up
   *  mounting and tearing down MilkDrop on the way to Bars. See
   *  state/seedStatus.ts. */
  loaded: boolean;
}

/** The merged style catalog. Refreshes when the Rust watcher fires
 *  `visualizers:changed`, so installing from the shop updates the V-cycle,
 *  Settings dropdown and gallery without a restart.
 *
 *  `installed` starts as `null`, not `[]`: an empty array is indistinguishable
 *  from "no bundles installed" from "the invoke hasn't resolved yet", and a
 *  consumer that can't tell those apart will misjudge a genuinely-installed
 *  bundle style as absent on every cold start (see `loaded` above).
 *
 *  `removed` is a parameter, not read from the tweaks store here: useTweaks is
 *  instantiated exactly once (App.tsx) and threaded down as props, so every
 *  caller passes `t.catalogRemoved` through. See state/removedContent.ts. */
export function useVizStyles(removed: string[]): VizStylesResult {
  const [installed, setInstalled] = useState<InstalledVizFolder[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    const load = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const list = await invoke<InstalledVizFolder[]>('visualizers_list');
        if (!cancelled) setInstalled(list);
      } catch {
        if (!cancelled) setInstalled([]);
      }
    };
    void load();
    import('@tauri-apps/api/event')
      .then(({ listen }) => listen('visualizers:changed', () => { void load(); }))
      .then((un) => { if (cancelled) un?.(); else unlisten = un; })
      .catch(() => {});
    return () => { cancelled = true; unlisten?.(); };
  }, []);

  // One-way latch set by App.tsx's seed_sync effect (success, failure or
  // watchdog). `useSyncExternalStore` rather than an effect + state so a
  // component mounting after seeding already settled reads `true` on its very
  // first render instead of flashing a frame of "pending".
  const seedSettled = useSyncExternalStore(subscribeSeedSettled, isSeedSettled, isSeedSettled);

  const styles = useMemo(
    () => applyRemovals(removed, mergeVizStyles(BUILTIN_VIZ_STYLES, installed ?? []), 'visualizer'),
    [removed, installed],
  );

  return { styles, loaded: installed !== null && seedSettled };
}
