// ─────────────────────────────────────────────────────────────────────────────
// "Has the boot seed sync finished?" — one app-wide latch.
//
// Why this exists: `seed_sync` (App.tsx) installs every seed bundle shipped in
// resources that isn't already installed, and it runs fire-and-forget AFTER
// tweaks hydrate and after first paint. `visualizers_list` (useVizStyles)
// resolves on mount, i.e. BEFORE that. So there is a window on every launch —
// not just a fresh install — where the installed list has honestly resolved to
// "these bundles are here" while the seeder is still writing the rest.
//
// A visualizer catalog read in that window is a lie of omission, and the viz
// surface acts on it: an upgrading user whose saved `bars` remapped to
// `bundle:bars` sees it as absent, falls back to the first thing that IS
// installed (MilkDrop), mounts a WebGL2 context plus a ~646 kB preset pack,
// then tears it all down a moment later when `visualizers:changed` fires. A
// brief blank frame is strictly better than that.
//
// So `useVizStyles` reports `loaded` only once BOTH the list has resolved and
// this latch is set, and `resolveVizSurface` holds at `pending` until then.
//
// Pure module: no React, no Tauri, so the latch is node-testable. The React
// binding is `useSyncExternalStore` in useVizStyles.ts; the caller (App.tsx)
// owns deciding when seeding has settled.
//
// One-way latch, deliberately: it is never un-set. "Seeding has finished at
// least once this process" is the only question consumers ask, and a later
// re-sync (Restore defaults, a per-item Restore) must not black out the
// surface again — those paths already refresh the catalog through the
// `visualizers:changed` watcher.
// ─────────────────────────────────────────────────────────────────────────────

let settled = false;
const listeners = new Set<() => void>();

/** Marks boot seeding as finished — success, failure, or watchdog. Idempotent:
 *  the second and later calls are no-ops and notify nobody, so a watchdog
 *  firing after a slow-but-successful sync costs a function call, not a
 *  spurious re-render. */
export function markSeedSettled(): void {
  if (settled) return;
  settled = true;
  for (const fn of [...listeners]) fn();
}

export function isSeedSettled(): boolean {
  return settled;
}

/** Subscribe shape `useSyncExternalStore` wants: returns its own unsubscribe. */
export function subscribeSeedSettled(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Test-only. The latch is module state by design (one per process), which
 *  makes it order-dependent across tests without a way to reset it. Not called
 *  from app code — a runtime "un-seed" is exactly what the one-way latch above
 *  exists to prevent. */
export function __resetSeedStatusForTests(): void {
  settled = false;
  listeners.clear();
}
