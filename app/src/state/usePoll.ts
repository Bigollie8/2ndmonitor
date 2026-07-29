import { useCallback, useEffect, useRef, useState } from 'react';

/** Delay before the next poll after `failures` consecutive errors.
 *  Doubles per failure, capped at 8x the base interval so a dead endpoint
 *  is retried at a civilized rate instead of hammered forever. */
export function backoffDelay(baseMs: number, failures: number): number {
  const n = Math.max(0, Math.min(3, failures));
  return baseMs * 2 ** n;
}

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
  const generationRef = useRef(0);
  const cleanupRef = useRef<(() => void) | null>(null);

  const run = useCallback(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    /** Set when a poll came due while the document was hidden. */
    let dueWhileHidden = false;
    let inFlight = false;

    const cancelled = () => generation !== generationRef.current;

    const schedule = () => {
      if (cancelled()) return;
      timer = setTimeout(fire, backoffDelay(intervalMs, failures));
    };

    const fire = () => {
      if (cancelled()) return;
      if (typeof document !== 'undefined' && document.hidden) {
        // Defer until visibilitychange; don't stack timers meanwhile.
        dueWhileHidden = true;
        return;
      }
      void load();
    };

    const load = async () => {
      if (inFlight || cancelled()) return;
      inFlight = true;
      try {
        const data = await fetcherRef.current();
        if (cancelled()) return;
        failures = 0;
        setState({ data, error: null, loading: false });
      } catch (err) {
        if (cancelled()) return;
        failures += 1;
        const message = err instanceof Error ? err.message : String(err);
        setState((prev) => ({ data: prev.data, error: message, loading: false }));
      } finally {
        inFlight = false;
      }
      schedule();
    };

    const onVisible = () => {
      if (typeof document !== 'undefined' && !document.hidden && dueWhileHidden) {
        dueWhileHidden = false;
        void load();
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisible);
    }

    void load();

    return () => {
      // Bump the generation so any in-flight fetch's setState is ignored.
      generationRef.current += 1;
      if (timer !== undefined) clearTimeout(timer);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisible);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, ...deps]);

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
