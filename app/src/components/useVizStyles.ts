// NOTE: .ts, no JSX in this file — see viz-styles.ts's module comment for why
// the plain style table stays React-free. This hook is the React-aware layer
// on top of it.
import { useEffect, useState } from 'react';
import { BUILTIN_VIZ_STYLES } from './viz-styles';
import { mergeVizStyles, type InstalledVizFolder, type VizStyleEntry } from '../state/contentRegistry';

/** The merged style catalog. Refreshes when the Rust watcher fires
 *  `visualizers:changed`, so installing from the shop updates the V-cycle,
 *  Settings dropdown and gallery without a restart. */
export function useVizStyles(): VizStyleEntry[] {
  const [installed, setInstalled] = useState<InstalledVizFolder[]>([]);

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

  return mergeVizStyles(BUILTIN_VIZ_STYLES, installed);
}
