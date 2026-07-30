// NOTE: .ts, no JSX in this file — see viz-styles.ts's module comment for why
// the plain style table stays React-free. This hook is the React-aware layer
// on top of it.
import { useEffect, useMemo, useState } from 'react';
import { BUILTIN_VIZ_STYLES } from './viz-styles';
import { mergeVizStyles, type InstalledVizFolder, type VizStyleEntry } from '../state/contentRegistry';
import { applyRemovals } from '../state/removedContent';

export interface VizStylesResult {
  styles: VizStyleEntry[];
  /** True once the first `visualizers_list` call has settled (success or
   *  failure). Callers that need to distinguish "no bundles installed" from
   *  "haven't heard back yet" — e.g. deciding whether a `bundle:` mode is
   *  really absent — must gate on this instead of checking `styles` alone. */
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

  const styles = useMemo(
    () => applyRemovals(removed, mergeVizStyles(BUILTIN_VIZ_STYLES, installed ?? []), 'visualizer'),
    [removed, installed],
  );

  return { styles, loaded: installed !== null };
}
