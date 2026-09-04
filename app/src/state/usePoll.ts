import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { pollHealth } from './pollHealth';
import { startPollLoop } from './pollLoop';
export { backoffDelay } from './pollLoop';

export interface PollState<T> {
  /** Last successful result. Survives later failures (stale-while-error). */
  data: T | null;
  /** String form of the last error, or null when the last fetch succeeded. */
  error: string | null;
  /** True until the first fetch settles (success or failure). */
  loading: boolean;
  updatedAt: number | null;
}

/** Shared polling loop for data tiles. Replaces the hand-rolled
 *  `let cancelled = false; setInterval(load, MS)` pattern with one that:
 *   - fetches immediately on mount and whenever `deps` change
 *   - keeps the last good `data` when a fetch throws, exposing `error`
 *   - backs off exponentially (up to 8x) on consecutive failures
 *   - skips fetches while the document is hidden, catching up as soon as
 *     the window becomes visible again if a poll came due meanwhile.
 *
 *  `fetcher` should THROW on failure (this is what drives backoff). Fetchers
 *  that historically returned `{ data, error }` or null-on-failure shapes
 *  should be wrapped so the error case throws. */
export function usePoll<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
  deps: unknown[] = [],
  healthLabel?: string,
  needsSetup = false,
): PollState<T> & { refresh: () => void } {
  const [state, setState] = useState<PollState<T>>({ data: null, error: null, loading: true, updatedAt: null });
  const healthId = useId();
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const cleanupRef = useRef<(() => void) | null>(null);

  const run = useCallback(() => startPollLoop({
    fetcher: async () => {
      const data = await fetcherRef.current();
      if (data == null && !needsSetup) throw new Error('No data returned');
      if (data && typeof data === 'object' && 'error' in data && data.error) throw new Error(String(data.error));
      return data;
    },
    intervalMs,
    onData: data => {
      const updatedAt = Date.now();
      pollHealth.patch(healthId, { updatedAt, failed: false, pending: false });
      setState({ data, error: null, loading: false, updatedAt });
    },
    onError: err => {
      pollHealth.patch(healthId, { failed: true, pending: false });
      setState(prev => ({ ...prev, error: err instanceof Error ? err.message : String(err), loading: false }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [intervalMs, needsSetup, ...deps]);

  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    // A new location/query must not inherit the old source's success timestamp.
    setState({ data: null, error: null, loading: true, updatedAt: null });
    if (healthLabel) pollHealth.put({ id: healthId, label: healthLabel, intervalMs, needsSetup, updatedAt: null, failed: false, pending: true, retry: () => refreshRef.current() });
    cleanupRef.current = run();
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
      pollHealth.remove(healthId);
    };
  }, [run, healthLabel, healthId, intervalMs, needsSetup]);

  const refresh = useCallback(() => {
    // Tear down the current loop and start a fresh one: immediate fetch,
    // failure count reset. Data is kept so the tile doesn't flash empty.
    cleanupRef.current?.();
    pollHealth.patch(healthId, { pending: true });
    cleanupRef.current = run();
  }, [run]);

  refreshRef.current = refresh;
  return { ...state, refresh };
}
