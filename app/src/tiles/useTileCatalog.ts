// NOTE: .ts, no JSX — mirrors app/src/components/useVizStyles.ts exactly, one
// layer down (tiles instead of viz styles). See that file's module comment
// for the full rationale; kept in sync deliberately.
import { useEffect, useMemo, useState } from 'react';
import { TILE_META } from '../state/tileMeta';
import { mergeTileCatalog, type InstalledTileFolder, type TileEntry } from './tileRegistry';
import { applyRemovals } from '../state/removedContent';

export interface TileCatalogResult {
  entries: TileEntry[];
  /** True once the first `tiles_list` call has settled (success or failure).
   *  Callers that need to distinguish "no bundle tiles installed" from
   *  "haven't heard back yet" — e.g. deciding whether a `bundle:` tile
   *  instance is really uninstalled vs. still loading — must gate on this
   *  instead of checking `entries` alone. */
  loaded: boolean;
}

/** The merged tile catalog (built-ins + installed bundles). Refreshes when
 *  the Rust watcher fires `tiles:changed`, so installing from the Marketplace
 *  updates the dashboard and Tile Library without a restart.
 *
 *  `installed` starts as `null`, not `[]`: an empty array is indistinguishable
 *  from "no bundle tiles installed" vs. "the invoke hasn't resolved yet", and
 *  a consumer that can't tell those apart will misjudge a genuinely-installed
 *  tile as absent on every cold start (see `loaded` above) — including
 *  rendering a "not installed" card for a tile that IS installed, for one
 *  frame on every launch. Do not seed this as `[]`.
 *
 *  `removed` is a parameter, not read from the tweaks store here: useTweaks is
 *  instantiated exactly once (App.tsx) and threaded down as props, so every
 *  caller passes `t.catalogRemoved` through. See state/removedContent.ts. */
export function useTileCatalog(removed: string[]): TileCatalogResult {
  const [installed, setInstalled] = useState<InstalledTileFolder[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    const load = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const list = await invoke<InstalledTileFolder[]>('tiles_list');
        if (!cancelled) setInstalled(list);
      } catch {
        if (!cancelled) setInstalled([]);
      }
    };
    void load();
    import('@tauri-apps/api/event')
      .then(({ listen }) => listen('tiles:changed', () => { void load(); }))
      .then((un) => { if (cancelled) un?.(); else unlisten = un; })
      .catch(() => {});
    return () => { cancelled = true; unlisten?.(); };
  }, []);

  // TileEntry keys on `type`, not `id` — applyRemovals wants `{id}`, so map
  // `type` onto `id` for the filter pass. The result still satisfies
  // TileEntry (the added `id` is just an extra field).
  const entries = useMemo(
    () => applyRemovals(removed, mergeTileCatalog(TILE_META, installed ?? []).map((e) => ({ ...e, id: e.type })), 'tile'),
    [removed, installed],
  );

  return { entries, loaded: installed !== null };
}
