import { useCallback, useEffect, useRef, useState } from 'react';

import { startPollLoop } from './pollLoop';
export { backoffDelay } from './pollLoop';

export interface PollState<T> {
  /** Last successful result. Survives later failures (stale-while-error). */
  data: T | null;
  /** String form of the last error, or null when the last fetch succeeded. */
  error: string | null;
  /** True until the first fetch settles (success or failure). */
  loading: boolean;
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
): PollState<T> & { refresh: () => void } {
  const [state, setState] = useState<PollState<T>>({ data: null, error: null, loading: true });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const cleanupRef = useRef<(() => void) | null>(null);

  const run = useCallback(() => startPollLoop({
    fetcher: () => fetcherRef.current(),
    intervalMs,
    onData: data => setState({ data, error: null, loading: false }),
    onError: err => setState(prev => ({
      data: prev.data, error: err instanceof Error ? err.message : String(err), loading: false,
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [intervalMs, ...deps]);

  useEffect(() => {
    cleanupRef.current = run();
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [run]);

  const refresh = useCallback(() => {
    // Tear down the current loop and start a fresh one: immediate fetch,
    // failure count reset. Data is kept so the tile doesn't flash empty.
    cleanupRef.current?.();
    cleanupRef.current = run();
  }, [run]);

  return { ...state, refresh };
}
