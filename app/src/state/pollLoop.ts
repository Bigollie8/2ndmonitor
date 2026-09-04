import { isAppHidden, subscribeVisibility } from './framePace';

export function backoffDelay(baseMs: number, failures: number): number {
  return Math.min(baseMs * 2 ** Math.max(0, Math.min(3, failures)), 2_147_483_647);
}

/** Own one non-overlapping polling generation. Kept independent of React so
 * native hide/resume, delayed responses and teardown can be exercised. */
export function startPollLoop<T>(options: {
  fetcher: () => Promise<T>;
  intervalMs: number;
  onData: (data: T) => void;
  onError: (error: unknown) => void;
}): () => void {
  let stopped = false;
  let inFlight = false;
  let dueWhileHidden = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const fire = () => {
    if (stopped || inFlight) return;
    if (isAppHidden()) { dueWhileHidden = true; return; }
    dueWhileHidden = false;
    void load();
  };
  const load = async () => {
    inFlight = true;
    try {
      const data = await options.fetcher();
      if (stopped) return;
      failures = 0;
      options.onData(data);
    } catch (error) {
      if (stopped) return;
      failures++;
      options.onError(error);
    } finally {
      inFlight = false;
    }
    if (!stopped) timer = setTimeout(fire, backoffDelay(options.intervalMs, failures));
  };
  const unsubscribe = subscribeVisibility(() => {
    if (dueWhileHidden && !isAppHidden()) fire();
  });
  fire();
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    unsubscribe();
  };
}
